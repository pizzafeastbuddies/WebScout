import { createServer } from 'node:http';
import type { RetrievalResponse } from '../engine/contract/internal';
import { OpenAICompatibleLLMAdapter } from '../engine/adapters/openaiCompatible';
import { WikimediaSearchProvider } from '../engine/discovery/providers/wikimedia';
import { DirectFetcher } from '../engine/fetch/directFetcher';
import { runRetrieval } from '../engine/run/pipeline';

/**
 * Resident engine server for the competition container.
 *
 * The grader starts a new process per question, so the engine runs here once and
 * `app.py` is a thin client. Listens on 127.0.0.1 only; nothing is exposed.
 *
 *   POST /answer  {"question": "...", "url": "optional"}  ->  {"answer", "confidence", ...}
 *   GET  /healthz                                          ->  ok
 *
 * It never throws to the caller: any failure becomes an empty answer.
 */

const PORT = Number(process.env.WEBSCOUT_PORT ?? 8765);
const BUDGET_MS = Number(process.env.WEBSCOUT_BUDGET_MS ?? 24_000);
const MAX_BODY_BYTES = 64 * 1024;

interface AnswerPayload {
  answer: string;
  confidence: number;
  sources: string[];
  abstainReason: string | null;
  timedOut: boolean;
  ms: number;
}

const empty = (extra: Partial<AnswerPayload> = {}): AnswerPayload => ({
  answer: '',
  confidence: 0,
  sources: [],
  abstainReason: null,
  timedOut: false,
  ms: 0,
  ...extra,
});

function toPayload(response: RetrievalResponse, ms: number): AnswerPayload {
  if (response.abstained || response.answer === null) {
    return empty({ abstainReason: response.abstainReason ?? 'no_evidence', ms });
  }
  const urls = [...new Set(response.evidence.map((item) => item.sourceUrl))];
  return {
    answer: response.answer,
    confidence: response.confidence,
    sources: urls,
    abstainReason: null,
    timedOut: false,
    ms,
  };
}

const deps = {
  fetcher: new DirectFetcher(),
  searchProviders: { wikimedia: new WikimediaSearchProvider() },
  // Optional model. Only used when WEBSCOUT_LLM_URL is set; otherwise the extractive path runs alone.
  llm: process.env.WEBSCOUT_LLM_URL
    ? new OpenAICompatibleLLMAdapter({
        baseUrl: process.env.WEBSCOUT_LLM_URL,
        model: process.env.WEBSCOUT_MODEL ?? 'Qwen/Qwen2.5-1.5B-Instruct',
        apiKey: process.env.WEBSCOUT_LLM_KEY,
        timeoutMs: Number(process.env.WEBSCOUT_LLM_TIMEOUT_MS ?? 12_000),
      })
    : undefined,
};

async function answer(question: string, url: string | undefined): Promise<AnswerPayload> {
  const started = Date.now();
  const run = runRetrieval({ question, startUrl: url }, deps)
    .then((response) => toPayload(response, Date.now() - started))
    .catch(() => empty({ abstainReason: 'engine_error', ms: Date.now() - started }));
  const budget = new Promise<AnswerPayload>((done) =>
    setTimeout(() => done(empty({ abstainReason: 'time_budget', timedOut: true, ms: BUDGET_MS })), BUDGET_MS),
  );
  return Promise.race([run, budget]);
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (request.method === 'GET' && request.url === '/healthz') {
    return send(200, { status: 'ok' });
  }

  if (request.method === 'POST' && request.url === '/answer') {
    try {
      const parsed = JSON.parse(await readBody(request)) as { question?: unknown; url?: unknown };
      const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
      const url = typeof parsed.url === 'string' && parsed.url.trim() ? parsed.url.trim() : undefined;
      if (!question) {
        return send(400, empty({ abstainReason: 'no_question' }));
      }
      const payload = await answer(question, url);
      console.log(
        JSON.stringify({ at: new Date().toISOString(), ms: payload.ms, answered: payload.answer !== '', reason: payload.abstainReason }),
      );
      return send(200, payload);
    } catch {
      return send(400, empty({ abstainReason: 'bad_request' }));
    }
  }

  return send(404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ at: new Date().toISOString(), event: 'listening', port: PORT, budgetMs: BUDGET_MS }));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
