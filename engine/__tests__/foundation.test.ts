import { describe, expect, it } from 'vitest';
import { NoopLLMAdapter } from '../adapters/llm';
import {
  DEFAULT_RETRIEVAL_OPTIONS,
  OPTION_BOUNDS,
  resolveOptions,
  type RetrievalResponse,
} from '../contract/internal';
import { findAll, getAttr, parseDocument, textContent } from '../dom/parseHtml';
import { FixtureFetcher, byteLength, failure, page } from '../fetch/fixtureFetcher';
import type { Evidence } from '../types';
import { FIXTURE_HTML, FIXTURE_URLS, createFixturePages } from './fixtures';

const MISSING_URL = 'https://fixtures.webscout.test/nimbus-relay/does-not-exist';

describe('FixtureFetcher', () => {
  it('serves a registered page as HTML', async () => {
    const fetcher = new FixtureFetcher(createFixturePages());
    const result = await fetcher.get(FIXTURE_URLS.relayRegions);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected the fixture to be served');
    expect(result.status).toBe(200);
    expect(result.contentType).toContain('text/html');
    expect(result.finalUrl).toBe(FIXTURE_URLS.relayRegions);
    expect(result.body).toContain('640 Gbit/s');
    expect(result.bytes).toBe(byteLength(FIXTURE_HTML.relayRegions));
  });

  it('returns a typed not_found failure for an unregistered URL instead of throwing', async () => {
    const fetcher = new FixtureFetcher(createFixturePages());
    const result = await fetcher.get(MISSING_URL);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure result');
    expect(result.error).toBe('not_found');
    expect(result.status).toBe(404);
    expect(result.requestedUrl).toBe(MISSING_URL);
  });

  it('serves configured failures, so error paths need no network', async () => {
    const fetcher = new FixtureFetcher({
      'https://slow.test/timeout': failure('timeout', { detail: 'simulated hang' }),
      'https://docs.test/report.pdf': failure('non_html', { contentType: 'application/pdf' }),
      'https://locked.test/private': failure('forbidden'),
    });

    const timedOut = await fetcher.get('https://slow.test/timeout');
    expect(timedOut.ok).toBe(false);
    if (timedOut.ok) throw new Error('expected a failure result');
    expect(timedOut.error).toBe('timeout');
    expect(timedOut.status).toBeUndefined();
    expect(timedOut.detail).toBe('simulated hang');

    const pdf = await fetcher.get('https://docs.test/report.pdf');
    if (pdf.ok) throw new Error('expected a failure result');
    expect(pdf.error).toBe('non_html');
    expect(pdf.contentType).toBe('application/pdf');

    const forbidden = await fetcher.get('https://locked.test/private');
    if (forbidden.ok) throw new Error('expected a failure result');
    expect(forbidden.error).toBe('forbidden');
    expect(forbidden.status).toBe(403);
  });

  it('records every URL attempted, in order', async () => {
    const fetcher = new FixtureFetcher();
    await fetcher.get('https://a.test/');
    await fetcher.get('https://b.test/');
    await fetcher.get('https://a.test/');

    expect(fetcher.attempts).toEqual(['https://a.test/', 'https://b.test/', 'https://a.test/']);

    fetcher.reset();
    expect(fetcher.attempts).toEqual([]);
  });

  it('tolerates a trailing-slash mismatch rather than reporting a false not_found', async () => {
    const fetcher = new FixtureFetcher({ 'https://fixtures.test/page/': page('<p>ok</p>') });

    const result = await fetcher.get('https://fixtures.test/page');
    expect(result.ok).toBe(true);
  });

  it('reports a simulated redirect through finalUrl', async () => {
    const fetcher = new FixtureFetcher({
      'https://short.test/x': page('<p>moved</p>', { finalUrl: 'https://long.test/landing' }),
    });

    const result = await fetcher.get('https://short.test/x');
    if (!result.ok) throw new Error('expected the fixture to be served');
    expect(result.finalUrl).toBe('https://long.test/landing');
  });
});

describe('parseHtml seam', () => {
  it('reads table cells and headers, and ignores script/style content', () => {
    const document = parseDocument(FIXTURE_HTML.relayRegions);

    const tables = findAll(document, 'table');
    expect(tables).toHaveLength(1);

    const table = tables[0];
    const headerTexts = findAll(table, 'th').map((cell) => textContent(cell));
    expect(headerTexts).toContain('Peak throughput');
    expect(headerTexts).toContain('Region');

    // The row header for the target cell is identifiable via scope="row".
    const chileRow = findAll(table, 'th').find(
      (cell) => getAttr(cell, 'scope') === 'row' && textContent(cell) === 'Chile',
    );
    expect(chileRow).toBeDefined();

    const visible = textContent(document);
    expect(visible).toContain('640 Gbit/s');
    expect(visible).toContain('Deployment by region');
    // JSON-LD lives inside a <script>, so its content must not become text.
    expect(visible).not.toContain('temporalCoverage');
    // Inline CSS must not leak into extracted text either.
    expect(visible).not.toContain('cookie-banner');
  });

  it('exposes source offsets so evidence can point back into the document', () => {
    const document = parseDocument(FIXTURE_HTML.relayRegions);
    const table = findAll(document, 'table')[0];

    expect(table.sourceCodeLocation).toBeTruthy();
    expect(table.sourceCodeLocation?.startOffset).toBeGreaterThan(0);
    expect(FIXTURE_HTML.relayRegions.slice(
      table.sourceCodeLocation?.startOffset,
      table.sourceCodeLocation?.endOffset,
    )).toContain('640 Gbit/s');
  });
});

describe('LLMAdapter', () => {
  it('defaults to a no-op so the extractive path is the only path', async () => {
    const llm = new NoopLLMAdapter();

    expect(llm.enabled).toBe(false);
    await expect(
      llm.synthesize({ question: 'anything', answerType: 'unknown', passages: [] }),
    ).resolves.toBeNull();
  });
});

describe('RetrievalOptions', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(resolveOptions()).toEqual(DEFAULT_RETRIEVAL_OPTIONS);
  });

  it('clamps out-of-range and non-finite values instead of trusting the caller', () => {
    expect(resolveOptions({ maxPages: 9999 }).maxPages).toBe(OPTION_BOUNDS.maxPages.max);
    expect(resolveOptions({ maxPages: 0 }).maxPages).toBe(OPTION_BOUNDS.maxPages.min);
    expect(resolveOptions({ maxDepth: -5 }).maxDepth).toBe(OPTION_BOUNDS.maxDepth.min);
    expect(resolveOptions({ timeoutMs: 10 }).timeoutMs).toBe(OPTION_BOUNDS.timeoutMs.min);
    expect(resolveOptions({ maxPages: Number.NaN }).maxPages).toBe(DEFAULT_RETRIEVAL_OPTIONS.maxPages);
    expect(resolveOptions({ maxPages: 3.7 }).maxPages).toBe(3);
  });

  it('honours an explicit search provider', () => {
    expect(resolveOptions({ searchProvider: 'duckduckgo' }).searchProvider).toBe('duckduckgo');
  });
});

describe('neutral response contract', () => {
  it('expresses abstention as data, not as an empty answer', () => {
    const response: RetrievalResponse = {
      question: 'What is the peak throughput in Chile?',
      answer: null,
      answerType: 'table_cell',
      confidence: 0,
      abstained: true,
      abstainReason: 'no_evidence',
      evidence: [],
      sources: [],
      trace: [],
    };

    expect(response.abstained).toBe(true);
    expect(response.answer).toBeNull();
    expect(response.abstainReason).toBe('no_evidence');
  });

  it('supports a table evidence item carrying row and column headers', () => {
    const evidence: Evidence = {
      id: 'ev-1',
      snippet: '640 Gbit/s',
      sourceUrl: FIXTURE_URLS.relayRegions,
      locator: { kind: 'table', rowHeader: 'Chile', columnHeader: 'Peak throughput' },
      matchType: 'exact',
    };

    expect(evidence.locator.rowHeader).toBe('Chile');
    expect(evidence.locator.columnHeader).toBe('Peak throughput');
  });
});

/**
 * Mechanical enforcement of the project's central constraint.
 *
 * Reads every runtime file under `engine/` (excluding this test directory) and
 * fails if any of them reaches for React, Supabase, or a Node/Deno-only API. A
 * violation is caught here, in CI, instead of when the engine is first copied
 * into the Edge Function or the AMD container.
 */
const ENGINE_SOURCES = import.meta.glob(['../**/*.ts', '!../__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const RUNTIME_SOURCES = Object.entries(ENGINE_SOURCES).filter(
  ([path]) => !path.includes('__tests__'),
);

const BANNED_MODULES = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'fs',
  'fs/promises',
  'path',
  'os',
  'child_process',
  'buffer',
  'stream',
  'util',
  'crypto',
  'zlib',
  'vm',
  'worker_threads',
  'module',
]);

const BANNED_MODULE_PREFIXES = ['@supabase/', 'node:', 'npm:', 'deno.land'];

const BANNED_GLOBALS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Deno', pattern: /\bDeno\b/ },
  { label: 'process', pattern: /\bprocess\b/ },
  { label: 'Buffer', pattern: /\bBuffer\b/ },
  { label: '__dirname', pattern: /\b__dirname\b/ },
  { label: 'require()', pattern: /\brequire\s*\(/ },
  { label: 'DOMParser', pattern: /\bDOMParser\b/ },
  // `window` and `document` only count as violations when actually dereferenced, so
  // that type aliases such as DefaultTreeAdapterMap['document'] are not false hits.
  { label: 'window', pattern: /\bwindow\s*[.(\[=]/ },
  { label: 'document', pattern: /\bdocument\s*[.(\[=]/ },
  { label: 'localStorage', pattern: /\blocalStorage\b/ },
];

/** Comments are stripped first so prose about these APIs is not itself flagged. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

describe('engine portability', () => {
  it('scans the whole runtime tree, so the guard cannot silently no-op', () => {
    const paths = RUNTIME_SOURCES.map(([path]) => path);
    expect(paths).toContain('../types.ts');
    expect(paths).toContain('../contract/internal.ts');
    expect(paths).toContain('../fetch/fixtureFetcher.ts');
    expect(paths).toContain('../dom/parseHtml.ts');
  });

  it('imports neither React nor Supabase, and no Node/Deno-only APIs', () => {
    const findings: string[] = [];

    for (const [path, source] of RUNTIME_SOURCES) {
      const code = stripComments(source);

      for (const match of code.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/')) {
          continue;
        }
        if (
          BANNED_MODULES.has(specifier) ||
          BANNED_MODULE_PREFIXES.some((prefix) => specifier.startsWith(prefix))
        ) {
          findings.push(`${path} imports "${specifier}"`);
        }
      }

      for (const { label, pattern } of BANNED_GLOBALS) {
        if (pattern.test(code)) {
          findings.push(`${path} uses ${label}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
