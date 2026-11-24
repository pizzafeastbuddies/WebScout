import { describe, expect, it } from 'vitest';
import type { ScoredCandidate } from '../answer/select';
import { groundAnswer, isRejected, verifyCandidate } from '../answer/verify';
import type { RetrievalResponse } from '../contract/internal';
import { FixtureFetcher, failure, page, type FixtureEntry } from '../fetch/fixtureFetcher';
import { runRetrieval } from '../run/pipeline';

/**
 * The pipeline's own test suite.
 *
 * Every case runs against fixtures, so the suite needs no network, no Supabase and
 * no credentials — the same guarantee the assessment demands of the engine. The
 * pages below are written by hand so the suite asserts *specific* behaviour (a row
 * header, a JSON pointer, a conflict) rather than whatever a live site happens to
 * contain today.
 */

const URLS = {
  regions: 'https://fixtures.test/nimbus/spec/regions',
  regionsMirror: 'https://fixtures.test/nimbus/spec/regions-mirror',
  regionsProse: 'https://fixtures.test/nimbus/spec/regions-prose',
  product: 'https://fixtures.test/nimbus/product',
  contact: 'https://fixtures.test/nimbus/contact',
  dead: 'https://fixtures.test/nimbus/dead',
} as const;

/** A spec page whose table carries the answer as a single cell. */
function regionsPage(options: { throughput: string; link?: string } = { throughput: '640 Gbit/s' }): string {
  const link = options.link ? `<p><a href="${options.link}">Mirror of the regional specification</a></p>` : '';
  return `<!doctype html>
<html>
<head><title>Nimbus Relay — deployment by region</title></head>
<body>
<main>
  <h1>Nimbus Relay</h1>
  <h2>Deployment by region</h2>
  <p>The Nimbus Relay is deployed in several regions.</p>
  <table>
    <thead>
      <tr><th scope="col">Region</th><th scope="col">Peak throughput</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">Chile</th><td>${options.throughput}</td></tr>
      <tr><th scope="row">Argentina</th><td>1.2 Tbit/s</td></tr>
    </tbody>
  </table>
  ${link}
</main>
</body>
</html>`;
}

/** The same figure, stated in prose instead of a table. */
const REGIONS_PROSE_PAGE = `<!doctype html>
<html>
<head><title>Nimbus Relay — regional notes</title></head>
<body>
<main>
  <h1>Nimbus Relay</h1>
  <h2>Deployment by region</h2>
  <p>Peak throughput measured in Chile reaches 612 Gbit/s.</p>
</main>
</body>
</html>`;

/** A product page publishing its version in JSON-LD rather than in prose. */
const PRODUCT_PAGE = `<!doctype html>
<html>
<head>
  <title>Nimbus Relay 4.2.1</title>
  <meta name="description" content="The Nimbus Relay is a network appliance." />
</head>
<body>
  <main>
    <h1>Nimbus Relay</h1>
    <p>The Nimbus Relay is a network appliance used by research teams.</p>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Nimbus Relay",
        "version": "4.2.1"
      }
    </script>
  </main>
</body>
</html>`;

/** A page that is about the subject but answers nothing about throughput. */
const CONTACT_PAGE = `<!doctype html>
<html>
<head><title>Contact — Nimbus Relay</title></head>
<body>
  <main>
    <h1>Contact</h1>
    <p>Our support desk answers questions about the Nimbus Relay during office hours.</p>
  </main>
</body>
</html>`;

function run(pages: Record<string, FixtureEntry>, request: Parameters<typeof runRetrieval>[0]): Promise<RetrievalResponse> {
  return runRetrieval(request, { fetcher: new FixtureFetcher(pages) });
}

const THROUGHPUT_QUESTION = 'What is the peak throughput in Chile?';

describe('pipeline: a question answered by a table cell', () => {
  it('returns the cell value located by its row and column headers', async () => {
    const response = await run({ [URLS.regions]: page(regionsPage()) }, { question: THROUGHPUT_QUESTION, startUrl: URLS.regions });

    expect(response.abstained).toBe(false);
    expect(response.answerType).toBe('table_cell');
    expect(response.answer).toContain('640');

    const evidence = response.evidence[0];
    expect(evidence?.snippet).toBe('640 Gbit/s');
    expect(evidence?.locator.kind).toBe('table');
    expect(evidence?.locator.rowHeader).toBe('Chile');
    expect(evidence?.locator.columnHeader).toBe('Peak throughput');
    expect(evidence?.locator.section).toBe('Deployment by region');
    expect(evidence?.matchType).toBe('exact');
    expect(evidence?.sourceUrl).toBe(URLS.regions);
  });

  it('reports the source it read, with a title a reviewer can recognise', async () => {
    const response = await run({ [URLS.regions]: page(regionsPage()) }, { question: THROUGHPUT_QUESTION, startUrl: URLS.regions });

    expect(response.sources).toHaveLength(1);
    expect(response.sources[0]?.status).toBe('fetched');
    expect(response.sources[0]?.title).toBe('Nimbus Relay — deployment by region');
    expect(response.sources[0]?.candidatesFound).toBeGreaterThan(0);
  });
});

describe('pipeline: a question answered by structured data', () => {
  it('returns the JSON-LD value with a pointer into the block', async () => {
    const response = await run({ [URLS.product]: page(PRODUCT_PAGE) }, { question: 'What version is the Nimbus Relay?', startUrl: URLS.product });

    expect(response.abstained).toBe(false);
    expect(response.answer).toBe('4.2.1');
    expect(response.answerType).toBe('version');

    const evidence = response.evidence[0];
    expect(evidence?.locator.kind).toBe('structured');
    expect(evidence?.locator.jsonPointer).toBe('/version');
  });

  it('rejects prose that mentions the subject but carries no version number', async () => {
    const response = await run({ [URLS.product]: page(PRODUCT_PAGE) }, { question: 'What version is the Nimbus Relay?', startUrl: URLS.product });

    // The sentence "The Nimbus Relay is a network appliance…" matches the question's
    // keywords but has no version in it, so it must not become the answer.
    expect(response.answer).toBe('4.2.1');
    expect(response.evidence.every((item) => item.snippet !== 'The Nimbus Relay is a network appliance used by research teams.')).toBe(true);
  });
});

describe('pipeline: abstention', () => {
  it('abstains with no_evidence when the page never states the answer', async () => {
    const response = await run({ [URLS.contact]: page(CONTACT_PAGE) }, { question: 'What is the peak throughput of the Nimbus Relay in Chile?', startUrl: URLS.contact });

    expect(response.abstained).toBe(true);
    expect(response.answer).toBeNull();
    expect(response.abstainReason).toBe('no_evidence');
    // The source is still reported, so the abstention is auditable.
    expect(response.sources.map((source) => source.url)).toContain(URLS.contact);
  });

  it('abstains with fetch_failed when nothing could be read, and never throws', async () => {
    const response = await run({ [URLS.dead]: failure('timeout', { detail: 'simulated hang' }) }, { question: THROUGHPUT_QUESTION, startUrl: URLS.dead });

    expect(response.abstained).toBe(true);
    expect(response.abstainReason).toBe('fetch_failed');
    expect(response.sources[0]?.status).toBe('failed');
    expect(response.sources[0]?.error).toBe('timeout');
  });

  it('abstains when the question carries no searchable terms', async () => {
    const response = await run({ [URLS.regions]: page(regionsPage()) }, { question: 'What is it?', startUrl: URLS.regions });

    expect(response.abstained).toBe(true);
    expect(response.abstainReason).toBe('no_evidence');
  });

  it('abstains with no_sources when there is no start URL and search is disabled', async () => {
    const response = await run({}, { question: THROUGHPUT_QUESTION, options: { allowSearch: false } });

    expect(response.abstained).toBe(true);
    expect(response.abstainReason).toBe('no_sources');
  });
});

describe('pipeline: conflicting sources', () => {
  it('abstains with contradictory_evidence when two sources are equally strong and disagree', async () => {
    const response = await run(
      {
        [URLS.regions]: page(regionsPage({ throughput: '640 Gbit/s', link: '/nimbus/spec/regions-mirror' })),
        [URLS.regionsMirror]: page(regionsPage({ throughput: '612 Gbit/s' })),
      },
      { question: THROUGHPUT_QUESTION, startUrl: URLS.regions, options: { maxDepth: 1 } },
    );

    expect(response.abstained).toBe(true);
    expect(response.abstainReason).toBe('contradictory_evidence');
    // Both sides of the disagreement are shown, so the user can judge for itself.
    const snippets = response.evidence.map((item) => item.snippet);
    expect(snippets).toContain('640 Gbit/s');
    expect(snippets).toContain('612 Gbit/s');
  });

  it('answers at reduced confidence when one source is clearly better grounded', async () => {
    const pages: Record<string, FixtureEntry> = {
      [URLS.regions]: page(regionsPage({ throughput: '640 Gbit/s', link: '/nimbus/spec/regions-prose' })),
      [URLS.regionsProse]: page(REGIONS_PROSE_PAGE),
    };

    const contested = await run(pages, { question: THROUGHPUT_QUESTION, startUrl: URLS.regions, options: { maxDepth: 1 } });
    const uncontested = await run(pages, { question: THROUGHPUT_QUESTION, startUrl: URLS.regions, options: { maxPages: 1, maxDepth: 0 } });

    expect(contested.abstained).toBe(false);
    // Both sources are cited: the answer and the one that disagrees with it.
    expect(new Set(contested.evidence.map((item) => item.sourceUrl)).size).toBe(2);
    expect(contested.confidence).toBeLessThan(uncontested.confidence);
    expect(contested.trace.some((event) => /disagree/i.test(event.detail))).toBe(true);
  });
});

describe('pipeline: navigation', () => {
  it('follows a link from the start URL to find the answer', async () => {
    const startPage = `<!doctype html><html><head><title>Index</title></head><body>
      <p>Regional throughput figures are published in the specification.</p>
      <p><a href="/nimbus/spec/regions">Regional throughput specification</a></p>
    </body></html>`;

    const response = await run(
      { [URLS.contact]: page(startPage), [URLS.regions]: page(regionsPage()) },
      { question: THROUGHPUT_QUESTION, startUrl: URLS.contact, options: { maxDepth: 1 } },
    );

    expect(response.abstained).toBe(false);
    expect(response.answer).toContain('640');
    expect(response.sources.map((source) => source.url)).toContain(URLS.regions);
    // The link was discovered via the page, not supplied by the caller.
    expect(response.sources.find((source) => source.url === URLS.regions)?.via).toBe('link');
  });

  it('does not follow links past the depth cap', async () => {
    const startPage = `<!doctype html><html><head><title>Index</title></head><body>
      <p><a href="/nimbus/spec/regions">Regional throughput specification</a></p>
    </body></html>`;

    const response = await run(
      { [URLS.contact]: page(startPage), [URLS.regions]: page(regionsPage()) },
      { question: THROUGHPUT_QUESTION, startUrl: URLS.contact, options: { maxDepth: 0 } },
    );

    // With depth 0 only the seed is read, so the answer is never reached.
    expect(response.abstained).toBe(true);
    expect(response.sources.map((source) => source.url)).toEqual([URLS.contact]);
  });
});

describe('pipeline: the run explains itself', () => {
  it('emits every stage in order and ends with format', async () => {
    const response = await run({ [URLS.regions]: page(regionsPage()) }, { question: THROUGHPUT_QUESTION, startUrl: URLS.regions });

    const stages = response.trace.map((event) => event.stage);
    expect(stages[0]).toBe('understand');
    expect(stages).toContain('discover');
    expect(stages).toContain('fetch');
    expect(stages).toContain('extract');
    expect(stages).toContain('select');
    expect(stages).toContain('verify');
    expect(stages[stages.length - 1]).toBe('format');
  });

  it('reaches format on an abstaining run too', async () => {
    const response = await run({ [URLS.dead]: failure('not_found') }, { question: THROUGHPUT_QUESTION, startUrl: URLS.dead });

    expect(response.trace[response.trace.length - 1]?.stage).toBe('format');
  });

  it('produces an identical response for an identical run', async () => {
    const pages = { [URLS.regions]: page(regionsPage()) };
    const request = { question: THROUGHPUT_QUESTION, startUrl: URLS.regions };

    const first = await run(pages, request);
    const second = await run(pages, request);

    // No timestamps and no clock anywhere in the contract: a run over fixed
    // fixtures must be reproducible, or recorded results would not mean anything.
    expect(second).toEqual(first);
  });
});

describe('verification gate', () => {
  it('accepts an answer that occurs in its evidence, exactly or normalised', () => {
    expect(groundAnswer('640 Gbit/s', 'The link runs at 640 Gbit/s.')).toEqual({ ok: true, matchType: 'exact' });
    expect(groundAnswer('640 GBIT/S', 'The link runs at 640 Gbit/s.').ok).toBe(true);
    expect(groundAnswer('640 GBIT/S', 'The link runs at 640 Gbit/s.').matchType).toBe('normalised');
  });

  it('rejects an answer that does not appear in the evidence', () => {
    const verdict = groundAnswer('641 Gbit/s', 'The link runs at 640 Gbit/s.');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/does not occur/i);
  });

  it('rejects a candidate whose snippet is not locatable in the retrieved document', () => {
    const scored: ScoredCandidate = {
      candidate: {
        text: '640 Gbit/s',
        sourceUrl: URLS.regions,
        locator: { kind: 'text' },
        context: '',
      },
      score: 10,
      matchedKeywords: ['chile'],
      typeMatch: true,
    };

    const verdict = verifyCandidate(scored, 'fact', 'A document that says nothing of the sort.');
    expect(isRejected(verdict)).toBe(true);
    if (isRejected(verdict)) {
      expect(verdict.reason).toMatch(/not locatable/i);
    }
  });

  it('rejects a candidate with the wrong shape for the question', () => {
    const scored: ScoredCandidate = {
      candidate: {
        text: 'The Nimbus Relay is a network appliance.',
        sourceUrl: URLS.product,
        locator: { kind: 'text' },
        context: '',
      },
      score: 10,
      matchedKeywords: ['version'],
      typeMatch: false,
    };

    const verdict = verifyCandidate(scored, 'version', 'The Nimbus Relay is a network appliance.');
    expect(isRejected(verdict)).toBe(true);
  });
});
