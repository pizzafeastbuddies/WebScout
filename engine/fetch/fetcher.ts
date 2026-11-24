import type { FetchResult } from '../types';

/**
 * Retrieves a URL. The engine only ever talks to this interface, which is what
 * lets the identical core run against saved fixtures in a test, against the live
 * web behind a Supabase Edge Function, and inside the AMD container:
 *
 *   - `FixtureFetcher`            (engine/fetch/fixtureFetcher.ts) — saved HTML, no network
 *   - `HttpFetcher`               (task 4) — real HTTP, used server-side
 *
 * Implementations MUST NOT throw for a page they cannot retrieve. Fetch failures
 * are returned as `FetchFailure` values so the pipeline can log the reason against
 * that source and continue with the others.
 */
export interface Fetcher {
  /** Stable identifier, e.g. `fixture` or `http`. */
  readonly id: string;
  get(url: string): Promise<FetchResult>;
}
