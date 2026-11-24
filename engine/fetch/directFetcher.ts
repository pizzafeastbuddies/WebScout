import { safeUrl } from '../util/url';
import type { FetchFailureReason, FetchResult } from '../types';
import { byteLength } from './fixtureFetcher';
import type { Fetcher } from './fetcher';

/**
 * A `Fetcher` that really goes to the network.
 *
 * It is deliberately stricter than `fetch` by default, because it is the only place
 * in the engine that talks to an arbitrary third party:
 *
 *   - a hard per-request timeout, so a hanging site cannot stall a run;
 *   - a content-type allowlist, so a PDF or an image is reported as `non_html`
 *     rather than being fed to the HTML parser;
 *   - a byte cap, so a pathological response cannot exhaust memory;
 *   - no credentials, and no throwing: every failure is returned as a value.
 *
 * Note it can only work where the *server* allows cross-origin reads. In a browser
 * that is a small set of CORS-enabled hosts (Wikimedia among them); for the open
 * web the same class runs inside the Supabase Edge Function, where no such
 * restriction applies. The pipeline cannot tell the difference.
 */

export interface DirectFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowedContentTypes?: readonly string[];
}

const DEFAULT_ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];
const DEFAULT_MAX_BYTES = 2_000_000;

function failure(
  requestedUrl: string,
  error: FetchFailureReason,
  detail?: string,
  status?: number,
  finalUrl?: string,
  contentType?: string,
): FetchResult {
  return { ok: false, requestedUrl, error, detail, status, finalUrl, contentType };
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'The request could not be completed';
}

export class DirectFetcher implements Fetcher {
  readonly id = 'direct';

  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly allowedContentTypes: readonly string[];

  constructor(options: DirectFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.allowedContentTypes = options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES;
  }

  async get(url: string): Promise<FetchResult> {
    const parsed = safeUrl(url);
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return failure(url, 'unsupported_scheme', 'Only http and https addresses can be read');
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        credentials: 'omit',
        headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1' },
      });

      const contentType = response.headers.get('content-type') ?? '';
      const finalUrl = response.url || parsed.toString();

      if (!this.isAllowed(contentType)) {
        return failure(url, 'non_html', `Refused content type "${contentType || 'unknown'}"`, response.status, finalUrl, contentType);
      }
      if (response.status === 404) {
        return failure(url, 'not_found', undefined, 404, finalUrl, contentType);
      }
      if (response.status === 401 || response.status === 403) {
        return failure(url, 'forbidden', undefined, response.status, finalUrl, contentType);
      }
      if (!response.ok) {
        return failure(url, 'network', `The server responded with HTTP ${response.status}`, response.status, finalUrl, contentType);
      }

      const body = await response.text();
      const bytes = byteLength(body);
      if (bytes > this.maxBytes) {
        return failure(url, 'too_large', `The response was ${bytes} bytes`, response.status, finalUrl, contentType);
      }

      return {
        ok: true,
        requestedUrl: url,
        finalUrl,
        status: response.status,
        contentType: contentType || 'text/html',
        body,
        bytes,
      };
    } catch (error) {
      if (timedOut) {
        return failure(url, 'timeout', `No response within ${this.timeoutMs}ms`);
      }
      return failure(url, 'network', describeError(error));
    } finally {
      clearTimeout(timer);
    }
  }

  /** A missing content type is treated as HTML: plenty of servers omit it. */
  private isAllowed(contentType: string): boolean {
    if (!contentType.trim()) {
      return true;
    }
    const value = contentType.toLowerCase();
    return this.allowedContentTypes.some((allowed) => value.includes(allowed));
  }
}
