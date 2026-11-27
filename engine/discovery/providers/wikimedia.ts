import type { SearchResult } from '../../types';
import { safeUrl } from '../../util/url';
import type { SearchProvider, SearchProviderId } from '../search';

/**
 * MediaWiki search — the engine's primary discovery provider.
 *
 * Chosen because it is keyless and CORS-enabled, which matters more than it
 * sounds: it means a real, working discovery path exists in the browser *before*
 * Supabase is connected and before any secret is involved. The whole MVP can run
 * with no credentials and no paid API, which is a hard requirement of the brief.
 *
 * Soft by contract: a rate-limited, blocked or unparseable response resolves to an
 * empty array. Discovery failing leads to a typed abstention, never a crash.
 */

export const WIKIMEDIA_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

export interface WikimediaSearchOptions {
  endpoint?: string;
  timeoutMs?: number;
  /** Extra attempts after an HTTP 429/503. Default 2. */
  retries?: number;
  /** Base wait before a retry. Default 1500 ms, multiplied by the attempt number. */
  retryDelayMs?: number;
}

/** Wikipedia's search API answers 429 after roughly nine quick requests. */
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_WAIT_MS = 4_000;

interface MediaWikiSearchItem {
  title?: unknown;
  snippet?: unknown;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
}

/**
 * Reads the MediaWiki envelope defensively. Every path is checked before use, so a
 * changed or error-shaped response degrades to "no results" instead of throwing
 * somewhere unexpected.
 */
function parseSearchResponse(payload: unknown): SearchResult[] {
  if (typeof payload !== 'object' || payload === null) {
    return [];
  }
  const query = (payload as { query?: unknown }).query;
  if (typeof query !== 'object' || query === null) {
    return [];
  }
  const search = (query as { search?: unknown }).search;
  if (!Array.isArray(search)) {
    return [];
  }

  const results: SearchResult[] = [];
  for (const entry of search) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { title, snippet } = entry as MediaWikiSearchItem;
    if (typeof title !== 'string' || !title.trim()) {
      continue;
    }
    results.push({
      title,
      url: articleUrl(title),
      snippet: stripTags(typeof snippet === 'string' ? snippet : ''),
    });
  }
  return results;
}

export class WikimediaSearchProvider implements SearchProvider {
  readonly id: SearchProviderId = 'wikimedia';

  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(options: WikimediaSearchOptions = {}) {
    this.endpoint = options.endpoint ?? WIKIMEDIA_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 1_500);
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const term = query.trim();
    if (!term) {
      return [];
    }

    const url = safeUrl(this.endpoint);
    if (!url) {
      return [];
    }
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', term);
    url.searchParams.set('srlimit', String(Math.max(1, Math.min(limit, 10))));
    url.searchParams.set('format', 'json');
    // Anonymous CORS access is granted only when the origin is announced.
    url.searchParams.set('origin', '*');

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let waitMs = 0;

      try {
        const response = await fetch(url.toString(), { signal: controller.signal, credentials: 'omit' });
        if (response.ok) {
          const payload: unknown = await response.json();
          return parseSearchResponse(payload);
        }
        if (!RETRYABLE_STATUS.has(response.status) || attempt === this.retries) {
          return [];
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : this.retryDelayMs * (attempt + 1);
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }

      await new Promise((done) => setTimeout(done, Math.min(waitMs, MAX_WAIT_MS)));
    }
    return [];
  }
}
