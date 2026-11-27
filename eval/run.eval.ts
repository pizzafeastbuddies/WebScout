import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { OpenAICompatibleLLMAdapter } from '../engine/adapters/openaiCompatible';
import { WikimediaSearchProvider } from '../engine/discovery/providers/wikimedia';
import { DirectFetcher } from '../engine/fetch/directFetcher';
import { runRetrieval } from '../engine/run/pipeline';
import { isCorrect, isUnanswerable } from './normalize';

/**
 * Live benchmark. Reads eval/questions.jsonl, runs each question through the real
 * engine against the real web, scores with eval/normalize.ts and writes a report.
 *
 *   npm run eval                       -> eval/results/latest.json
 *   EVAL_OUT=baseline-2026-11-27 npm run eval -> eval/results/baseline-2026-11-27.json
 *   EVAL_IDS=n01,d01 npm run eval      -> only those questions
 *
 * Live pages change, so a score can move slightly between days. Compare runs made
 * on the same day, and keep the report as evidence.
 */

interface Question {
  id: string;
  category: string;
  question: string;
  startUrl?: string;
  accepted: string[];
}

const here = dirname(fileURLToPath(import.meta.url));

it('benchmark', { timeout: 20 * 60_000 }, async () => {
  const only = process.env.EVAL_IDS?.split(',').map((s) => s.trim());
  const questions: Question[] = readFileSync(resolve(here, 'questions.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Question)
    .filter((q) => !only || only.includes(q.id));

  const llm = process.env.WEBSCOUT_LLM_URL
    ? new OpenAICompatibleLLMAdapter({
        baseUrl: process.env.WEBSCOUT_LLM_URL,
        model: process.env.WEBSCOUT_MODEL ?? 'Qwen/Qwen2.5-1.5B-Instruct',
        timeoutMs: Number(process.env.WEBSCOUT_LLM_TIMEOUT_MS ?? 12_000),
      })
    : undefined;
  const deps = { fetcher: new DirectFetcher(), searchProviders: { wikimedia: new WikimediaSearchProvider() }, llm };
  const rows = [];
  // Wikipedia's search API answers HTTP 429 after roughly 9 quick requests. EVAL_PACE_MS
  // spaces questions out so a run measures extraction, not rate limiting. 0 = no pacing.
  const paceMs = Number(process.env.EVAL_PACE_MS ?? 0);

  for (const q of questions) {
    if (paceMs > 0 && rows.length > 0) {
      await new Promise((done) => setTimeout(done, paceMs));
    }
    const started = Date.now();
    const response = await runRetrieval({ question: q.question, startUrl: q.startUrl }, deps);
    const ms = Date.now() - started;
    const answer = response.answer ?? '';
    rows.push({
      id: q.id,
      category: q.category,
      question: q.question,
      startUrl: q.startUrl ?? null,
      accepted: q.accepted,
      answer,
      pass: isCorrect(answer, q.accepted),
      unanswerable: isUnanswerable(q.accepted),
      confidence: response.confidence,
      abstainReason: response.abstainReason ?? null,
      sourceUrl: response.evidence[0]?.sourceUrl ?? null,
      pagesFetched: response.sources.filter((s) => s.status === 'fetched').length,
      fetchErrors: response.sources.filter((s) => s.status === 'failed').map((s) => s.error ?? 'unknown'),
      ms,
    });
  }

  const byCategory: Record<string, { pass: number; total: number }> = {};
  for (const row of rows) {
    const bucket = (byCategory[row.category] ??= { pass: 0, total: 0 });
    bucket.total += 1;
    bucket.pass += row.pass ? 1 : 0;
  }

  const answerable = rows.filter((r) => !r.unanswerable);
  const wrongAnswers = rows.filter((r) => !r.pass && r.answer !== '').length;
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);

  const report = {
    date: new Date().toISOString(),
    paceMs,
    total: rows.length,
    passed: rows.filter((r) => r.pass).length,
    answerablePassed: answerable.filter((r) => r.pass).length,
    answerableTotal: answerable.length,
    unanswerablePassed: rows.filter((r) => r.unanswerable && r.pass).length,
    unanswerableTotal: rows.length - answerable.length,
    confidentWrong: wrongAnswers,
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    maxMs: times[times.length - 1] ?? 0,
    byCategory,
    rows,
  };

  const outDir = resolve(here, 'results');
  mkdirSync(outDir, { recursive: true });
  const name = process.env.EVAL_OUT ?? 'latest';
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');

  console.log(`EVAL ${report.passed}/${report.total} passed | answerable ${report.answerablePassed}/${report.answerableTotal} | unanswerable ${report.unanswerablePassed}/${report.unanswerableTotal} | wrong-but-answered ${wrongAnswers} | median ${report.medianMs} ms`);
  for (const [category, value] of Object.entries(byCategory)) {
    console.log(`EVAL   ${category}: ${value.pass}/${value.total}`);
  }
});
