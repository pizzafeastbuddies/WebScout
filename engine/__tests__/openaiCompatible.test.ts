import { describe, expect, it } from 'vitest';
import { checkLLMHealth, OpenAICompatibleLLMAdapter, parseClaims } from '../adapters/openaiCompatible';

const request = {
  question: 'When was the bridge opened?',
  answerType: 'date' as const,
  passages: [{ evidenceId: 'ev-1', text: 'The bridge opened in 1937.' }],
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

function chat(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('OpenAICompatibleLLMAdapter', () => {
  it('returns claims that cite known evidence', async () => {
    const llm = new OpenAICompatibleLLMAdapter({
      baseUrl: 'http://x/v1/',
      model: 'm',
      fetchImpl: fakeFetch(200, chat('{"claims":[{"text":"1937","evidenceIds":["ev-1"]}]}')),
    });
    expect(await llm.synthesize(request)).toEqual({ claims: [{ text: '1937', evidenceIds: ['ev-1'] }] });
  });

  it('drops claims citing unknown evidence', () => {
    const result = parseClaims('{"claims":[{"text":"x","evidenceIds":["ev-9"]}]}', new Set(['ev-1']));
    expect(result).toEqual({ claims: [] });
  });

  it('returns null on a server error, bad JSON, or no server', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    for (const fetchImpl of [fakeFetch(500, {}), fakeFetch(200, chat('not json')), down]) {
      const llm = new OpenAICompatibleLLMAdapter({ baseUrl: 'http://x/v1', model: 'm', fetchImpl });
      expect(await llm.synthesize(request)).toBeNull();
    }
  });

  it('sends the API key only as a header', async () => {
    let auth: string | null = null;
    const spy = (async (_url: string, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify(chat('{"claims":[]}')), { status: 200 });
    }) as typeof fetch;
    await new OpenAICompatibleLLMAdapter({ baseUrl: 'http://x/v1', model: 'm', apiKey: 'k', fetchImpl: spy }).synthesize(
      request,
    );
    expect(auth).toBe('Bearer k');
  });
});

describe('checkLLMHealth', () => {
  it('reports served models', async () => {
    const health = await checkLLMHealth('http://x/v1', { fetchImpl: fakeFetch(200, { data: [{ id: 'qwen' }] }) });
    expect(health).toEqual({ available: true, models: ['qwen'] });
  });

  it('reports unavailable when the server is down', async () => {
    const health = await checkLLMHealth('http://x/v1', { fetchImpl: fakeFetch(503, {}) });
    expect(health.available).toBe(false);
  });
});
