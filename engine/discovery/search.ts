import type { SearchResult } from '../types';

/**
 * Which search backend to use. Declared here rather than in the contract module so
 * that `contract/internal.ts` can import it without creating an import cycle.
 */
export type SearchProviderId = 'wikimedia' | 'duckduckgo';

/** Sensible default number of search results to consider per run. */
export const DEFAULT_SEARCH_LIMIT = 5;

/**
 * Finds candidate pages for a question that has no start URL.
 *
 * Implementations must be SOFT: a provider that is rate-limited, blocked, or
 * returns unparseable output resolves to an empty array rather than throwing.
 * Discovery failing is a normal outcome that leads to a typed abstention, not a
 * crash, and there is always another provider to fall back to.
 *
 * Note there is deliberately no `AbortSignal` parameter: timeouts are configured
 * when the provider is constructed, so the interface stays minimal.
 */
export interface SearchProvider {
  readonly id: SearchProviderId;
  search(query: string, limit: number): Promise<SearchResult[]>;
}
