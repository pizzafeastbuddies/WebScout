import type { FixtureEntry } from '../../engine/fetch/fixtureFetcher';
import { page } from '../../engine/fetch/fixtureFetcher';
import type { SearchProvider, SearchProviderId } from '../../engine/discovery/search';
import type { SearchResult } from '../../engine/types';

/**
 * Saved pages that make the app demonstrable with no network at all.
 *
 * There is a real reason this exists rather than being a gimmick. A browser cannot
 * read arbitrary third-party sites — the sites do not send CORS headers — so the
 * live path in this preview can only reach a small set of hosts. Without saved
 * pages the app would have nothing to show, and the interesting parts of the engine
 * (a table cell located by its row and column headers, a JSON-LD value, an honest
 * abstention) would be invisible.
 *
 * These are snapshots, not live sites. Following a source link will not open
 * anything: the addresses use the reserved `.example` TLD on purpose, so nothing
 * here can be mistaken for a real URL.
 */

export const DEMO_URLS = {
  spec: 'https://nimbus-relay.example/spec/regions',
  product: 'https://nimbus-relay.example/product',
  contact: 'https://nimbus-relay.example/contact',
} as const;

export const DEMO_SNAPSHOT_NOTE =
  'Saved page snapshots — a deterministic, offline source set. The links are illustrative and are not live addresses.';

const SPEC_PAGE = `<!doctype html>
<html>
<head>
  <title>Nimbus Relay — deployment by region</title>
  <meta name="description" content="Regional deployment figures for the Nimbus Relay." />
</head>
<body>
  <main>
    <h1>Nimbus Relay</h1>
    <p>The Nimbus Relay is a network appliance deployed across several regions.</p>
    <h2>Deployment by region</h2>
    <table>
      <thead>
        <tr><th scope="col">Region</th><th scope="col">Peak throughput</th><th scope="col">Sites</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Chile</th><td>640 Gbit/s</td><td>4</td></tr>
        <tr><th scope="row">Argentina</th><td>1.2 Tbit/s</td><td>6</td></tr>
        <tr><th scope="row">Finland</th><td>880 Gbit/s</td><td>3</td></tr>
      </tbody>
    </table>
    <p>Regional capacity is reviewed every quarter against measured peak throughput.</p>
    <p>See the <a href="/product">product page</a> for the current release.</p>
  </main>
</body>
</html>`;

const PRODUCT_PAGE = `<!doctype html>
<html>
<head>
  <title>Nimbus Relay — product</title>
  <meta name="description" content="The Nimbus Relay is a network appliance." />
</head>
<body>
  <main>
    <h1>Nimbus Relay</h1>
    <h2>Release information</h2>
    <p>The Nimbus Relay is a network appliance used by research teams.</p>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Nimbus Relay",
        "version": "4.2.1",
        "manufacturer": "Nimbus Systems"
      }
    </script>
  </main>
</body>
</html>`;

const CONTACT_PAGE = `<!doctype html>
<html>
<head>
  <title>Contact — Nimbus Relay</title>
</head>
<body>
  <main>
    <h1>Contact</h1>
    <p>Our support desk answers questions about the Nimbus Relay during office hours.</p>
  </main>
</body>
</html>`;

export const DEMO_PAGES: Record<string, FixtureEntry> = {
  [DEMO_URLS.spec]: page(SPEC_PAGE),
  [DEMO_URLS.product]: page(PRODUCT_PAGE),
  [DEMO_URLS.contact]: page(CONTACT_PAGE),
};

/**
 * A search provider over the saved pages, so a question *without* a start URL
 * still exercises discovery in demo mode. It deliberately ignores the query: with
 * three fixed pages there is nothing to rank.
 */
export class DemoSearchProvider implements SearchProvider {
  readonly id: SearchProviderId = 'wikimedia';

  async search(_query: string, limit: number): Promise<SearchResult[]> {
    return Object.entries(DEMO_PAGES)
      .slice(0, limit)
      .map(([url, entry]) => ({
        title: 'body' in entry ? 'Saved page snapshot' : 'Unavailable snapshot',
        url,
        snippet: 'Saved page snapshot',
      }));
  }
}
