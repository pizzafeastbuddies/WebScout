import { page, type FixtureEntry } from '../../fetch/fixtureFetcher';
import sparsePageHtml from './sparse-page.html?raw';
import tablePageHtml from './table-page.html?raw';

/**
 * The saved pages used by the deterministic fixture tests, exposed as strings.
 *
 * Files are pulled in with Vite's `?raw` import so that no filesystem access is
 * needed anywhere — the same reason `engine/fetch/fixtureFetcher.ts` takes plain
 * strings rather than paths.
 *
 * NOTE: this directory is test harness, not engine runtime. It is the one place
 * under `engine/` allowed to use build-tool-specific syntax (`?raw`), and the
 * Edge Function bundle must exclude `engine/__tests__/` when the engine is synced
 * into it (task 4). Everything the engine actually ships lives outside this folder
 * and uses only standard web APIs.
 */

/**
 * Fixture URLs are stable, deterministically named, and deliberately match the
 * shape of real URLs so that evidence locators and source links look realistic.
 */
export const FIXTURE_URLS = {
  /** A content page with a spec table: supports table-cell extraction. */
  relayRegions: 'https://fixtures.webscout.test/nimbus-relay/regions',
  /** A page with no operational figures: supports the no-evidence abstention path. */
  relayContact: 'https://fixtures.webscout.test/nimbus-relay/contact',
} as const;

export const FIXTURE_HTML = {
  relayRegions: tablePageHtml,
  relayContact: sparsePageHtml,
} as const;

/** Ready-to-register `url -> entry` map for a `FixtureFetcher`. */
export function createFixturePages(): Record<string, FixtureEntry> {
  return {
    [FIXTURE_URLS.relayRegions]: page(FIXTURE_HTML.relayRegions),
    [FIXTURE_URLS.relayContact]: page(FIXTURE_HTML.relayContact),
  };
}
