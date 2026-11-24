import type { FetchFailureReason, FetchResult } from '../types';
import type { Fetcher } from './fetcher';

/**
 * A `Fetcher` backed by saved HTML instead of the network.
 *
 * This is what makes the whole retrieval pipeline testable and demonstrable with
 * no network, no Supabase and no credentials. It is also how failure paths are
 * exercised: a URL can be registered as a timeout, a 403, or a non-HTML response,
 * so the pipeline's error handling is tested without needing a flaky real server.
 *
 * The fixture bodies are plain strings supplied by the caller, which keeps this
 * file free of any filesystem access — important, because `engine/` must run in
 * the browser and in Deno as well as in Node. Loading saved files into strings is
 * the test harness's job (see `engine/__tests__/fixtures/index.ts`).
 */

/** A page served from a fixture. */
export interface FixturePage {
  body: string;
  /** Defaults to `text/html; charset=utf-8`. */
  contentType?: string;
  /** Defaults to 200. */
  status?: number;
  /** Set when simulating a redirect, so the resolved URL differs from the requested one. */
  finalUrl?: string;
}

/** A failure served from a fixture. */
export interface FixtureFailure {
  error: FetchFailureReason;
  status?: number;
  contentType?: string;
  detail?: string;
}

export type FixtureEntry = FixturePage | FixtureFailure;

export const DEFAULT_HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

/**
 * Sensible default HTTP status per failure kind. Exhaustive by construction: adding
 * a `FetchFailureReason` without handling it here is a compile error.
 */
const DEFAULT_STATUS_BY_ERROR: Record<FetchFailureReason, number | undefined> = {
  timeout: undefined,
  not_found: 404,
  forbidden: 403,
  disallowed: undefined,
  too_large: undefined,
  non_html: 200,
  too_many_redirects: undefined,
  budget_exhausted: undefined,
  unsupported_scheme: undefined,
  network: undefined,
};

const textEncoder = new TextEncoder();

/** UTF-8 byte length, without reaching for Node's `Buffer`. */
export function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function isFailure(entry: FixtureEntry): entry is FixtureFailure {
  return 'error' in entry;
}

/** Register a served page. */
export function page(body: string, overrides: Partial<Omit<FixturePage, 'body'>> = {}): FixturePage {
  return {
    body,
    contentType: DEFAULT_HTML_CONTENT_TYPE,
    status: 200,
    ...overrides,
  };
}

/** Register a failure. */
export function failure(
  error: FetchFailureReason,
  overrides: Partial<Omit<FixtureFailure, 'error'>> = {},
): FixtureFailure {
  return {
    error,
    status: DEFAULT_STATUS_BY_ERROR[error],
    ...overrides,
  };
}

export class FixtureFetcher implements Fetcher {
  readonly id = 'fixture';

  /** Every URL requested, in call order. Tests assert against this. */
  readonly attempts: string[] = [];

  private readonly pages = new Map<string, FixtureEntry>();

  constructor(pages: Record<string, FixtureEntry> = {}) {
    this.registerMany(pages);
  }

  register(url: string, entry: FixtureEntry): void {
    this.pages.set(url, entry);
  }

  registerMany(pages: Record<string, FixtureEntry>): void {
    for (const [url, entry] of Object.entries(pages)) {
      this.pages.set(url, entry);
    }
  }

  /** Clears the attempt log so a shared fetcher can be reused between assertions. */
  reset(): void {
    this.attempts.length = 0;
  }

  async get(url: string): Promise<FetchResult> {
    this.attempts.push(url);

    const entry = this.lookup(url);
    if (entry === undefined) {
      return {
        ok: false,
        requestedUrl: url,
        error: 'not_found',
        status: 404,
        detail: `No fixture registered for ${url}`,
      };
    }

    if (isFailure(entry)) {
      return {
        ok: false,
        requestedUrl: url,
        error: entry.error,
        status: entry.status,
        contentType: entry.contentType,
        detail: entry.detail,
      };
    }

    const contentType = entry.contentType ?? DEFAULT_HTML_CONTENT_TYPE;
    return {
      ok: true,
      requestedUrl: url,
      finalUrl: entry.finalUrl ?? url,
      status: entry.status ?? 200,
      contentType,
      body: entry.body,
      bytes: byteLength(entry.body),
    };
  }

  /**
   * Exact match first, then a trailing-slash-tolerant match — a mismatch on the
   * trailing slash is by far the most common way a hand-written fixture URL fails
   * to resolve, and it produces a confusing `not_found` that looks like a bug in
   * the pipeline.
   */
  private lookup(url: string): FixtureEntry | undefined {
    const direct = this.pages.get(url);
    if (direct !== undefined) {
      return direct;
    }
    const alternate = url.endsWith('/') ? url.slice(0, -1) : `${url}/`;
    return this.pages.get(alternate);
  }
}

export function createFixtureFetcher(pages: Record<string, FixtureEntry> = {}): FixtureFetcher {
  return new FixtureFetcher(pages);
}
