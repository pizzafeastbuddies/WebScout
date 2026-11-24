import type { EngineDeps, RetrievalRequest, RetrievalResponse } from '../../engine/contract/internal';
import type { SearchProvider } from '../../engine/discovery/search';
import { WikimediaSearchProvider } from '../../engine/discovery/providers/wikimedia';
import { DirectFetcher } from '../../engine/fetch/directFetcher';
import { FixtureFetcher } from '../../engine/fetch/fixtureFetcher';
import { runRetrieval } from '../../engine/run/pipeline';
import { DEMO_PAGES, DemoSearchProvider } from './demoFixtures';

/**
 * The API boundary between the UI and the engine.
 *
 * The UI knows about exactly two operations — pick a set of dependencies, run a
 * request — and nothing about how retrieval works. That boundary is the same one
 * the Supabase Edge Function will sit behind: when the server-side fetcher arrives,
 * this file gains one more `Fetcher` and the components do not change at all.
 */

export type SourceMode = 'live' | 'demo';

/**
 * Which dependency set a run uses.
 *
 * `live` reads the real web with the browser's own `fetch`, which is bound by CORS:
 * hosts that send CORS headers (Wikimedia among them) work, most do not, and a
 * blocked site is reported as a failed source rather than an error. `demo` reads
 * the saved snapshots and needs no network whatsoever.
 */
function createDeps(mode: SourceMode): EngineDeps {
  if (mode === 'demo') {
    return {
      fetcher: new FixtureFetcher(DEMO_PAGES),
      searchProviders: { wikimedia: new DemoSearchProvider() },
    };
  }

  const searchProviders: Record<string, SearchProvider> = {
    wikimedia: new WikimediaSearchProvider(),
  };

  return { fetcher: new DirectFetcher(), searchProviders };
}

export async function runQuery(request: RetrievalRequest, mode: SourceMode): Promise<RetrievalResponse> {
  return runRetrieval(request, createDeps(mode));
}
