import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMAdapter, SynthesisRequest, SynthesisResult } from '../adapters/llm';
import { shapeAnswer, stripCitationMarks } from '../answer/shape';
import { WikimediaSearchProvider } from '../discovery/providers/wikimedia';
import { DirectFetcher } from '../fetch/directFetcher';
import { FixtureFetcher, page } from '../fetch/fixtureFetcher';
import { runRetrieval } from '../run/pipeline';

/** A scripted model: it answers however the test tells it to, and records what it was shown. */
class ScriptedModel implements LLMAdapter {
  readonly id = 'scripted';
  readonly enabled = true;
  seen: SynthesisRequest | null = null;
  private readonly reply: (request: SynthesisRequest) => SynthesisResult | null;
  constructor(reply: (request: SynthesisRequest) => SynthesisResult | null) {
    this.reply = reply;
  }
  async synthesize(request: SynthesisRequest): Promise<SynthesisResult | null> {
    this.seen = request;
    return this.reply(request);
  }
}

const URL = 'https://fixtures.test/chile';
const PAGE = `<!doctype html><html><head><title>Chile</title></head><body><main>
  <h1>Chile</h1>
  <p>The capital city of Chile is Santiago, which lies in the central valley.</p>
  <p>Chile borders Peru to the north.</p>
</main></body></html>`;

const deps = (llm?: LLMAdapter) => ({ fetcher: new FixtureFetcher({ [URL]: page(PAGE) }), llm });
const ask = (llm?: LLMAdapter) =>
  runRetrieval({ question: 'What is the capital city of Chile?', startUrl: URL }, deps(llm));

describe('answer shaping', () => {
  it('removes citation marks', () => {
    expect(stripCitationMarks('392,404 (2025)[3]')).toBe('392,404 (2025)');
    expect(stripCitationMarks('Santiago [a] is large [note 2]')).toBe('Santiago is large');
  });

  it('reduces a full date to a year only when a year is asked for', () => {
    expect(shapeAnswer('In what year did the Berlin Wall fall?', 'date', '9 November 1989')).toBe('1989');
    expect(shapeAnswer('On what date did the Berlin Wall fall?', 'date', '9 November 1989')).toBe('9 November 1989');
  });
});

describe('pipeline with a model', () => {
  it('without a model, the extractive answer is unchanged', async () => {
    const response = await ask();
    expect(response.answer).toContain('Santiago');
    expect(response.answer?.length).toBeGreaterThan('Santiago'.length);
  });

  it('returns the exact value the model picks, grounded in the page', async () => {
    const model = new ScriptedModel(() => ({ claims: [{ text: 'Santiago', evidenceIds: ['ev-1'] }] }));
    const response = await ask(model);
    expect(response.answer).toBe('Santiago');
    expect(response.abstained).toBe(false);
    expect(response.evidence[0]?.sourceUrl).toBe(URL);
    expect(model.seen?.passages.length).toBeGreaterThan(0);
  });

  it('drops a value the model invented and abstains', async () => {
    const model = new ScriptedModel(() => ({ claims: [{ text: 'Valparaiso', evidenceIds: ['ev-1'] }] }));
    const response = await ask(model);
    expect(response.answer).toBeNull();
    expect(response.abstained).toBe(true);
  });

  it('drops a claim that cites an evidence id it was never shown', async () => {
    const model = new ScriptedModel(() => ({ claims: [{ text: 'Santiago', evidenceIds: ['ev-99'] }] }));
    expect((await ask(model)).answer).toBeNull();
  });

  it('abstains when the model says the passages do not answer', async () => {
    const model = new ScriptedModel(() => ({ claims: [] }));
    expect((await ask(model)).abstained).toBe(true);
  });

  it('falls back to the extractive answer when the model is unreachable', async () => {
    const model = new ScriptedModel(() => null);
    const response = await ask(model);
    expect(response.answer).toContain('Santiago');
  });
});

describe('WikimediaSearchProvider rate limits', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = () =>
    new Response(JSON.stringify({ query: { search: [{ title: 'Santiago', snippet: 'capital' }] } }), { status: 200 });

  it('retries after an HTTP 429 and then returns results', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const results = await new WikimediaSearchProvider({ retryDelayMs: 1 }).search('capital chile', 3);
    expect(results.map((r) => r.title)).toEqual(['Santiago']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries and returns nothing, never throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await new WikimediaSearchProvider({ retryDelayMs: 1, retries: 2 }).search('x y', 3);
    expect(results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await new WikimediaSearchProvider({ retryDelayMs: 1 }).search('x y', 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DirectFetcher large pages', () => {
  afterEach(() => vi.unstubAllGlobals());

  const html = (size: number) =>
    new Response('<html><body><p>' + 'a'.repeat(size) + '</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });

  it('reads a page over the cap up to the cap instead of refusing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html(3_000)));
    const result = await new DirectFetcher({ maxBytes: 1_000 }).get('https://example.org/big');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes).toBeLessThanOrEqual(1_000);
    }
  });

  it('still refuses a pathologically large response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html(10_000)));
    const result = await new DirectFetcher({ maxBytes: 1_000 }).get('https://example.org/huge');
    expect(result.ok).toBe(false);
  });
});
