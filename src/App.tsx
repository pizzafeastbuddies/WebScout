import { useMemo, useState } from 'react';
import type { RetrievalResponse } from '../engine/contract/internal';
import { AnswerCard } from './components/AnswerCard';
import { EvidenceList } from './components/EvidenceList';
import { PipelineTimeline } from './components/PipelineTimeline';
import { QueryPanel, type QueryPanelValues } from './components/QueryPanel';
import { SourcesPanel } from './components/SourcesPanel';
import { DEMO_SNAPSHOT_NOTE } from './lib/demoFixtures';
import { buildTimeline, describeAbstention, evidenceSummary, type Example } from './lib/display';
import { runQuery } from './lib/engineClient';
import { DEMO_EXAMPLES, LIVE_EXAMPLES } from './lib/examples';

type Status = 'idle' | 'running' | 'done';

const INITIAL_VALUES: QueryPanelValues = {
  question: '',
  startUrl: '',
  // Demo starts first on purpose: it needs no network and always produces a real
  // result, so the first thing a visitor sees is the engine working.
  mode: 'demo',
  maxPages: 5,
  maxDepth: 1,
  allowSearch: true,
};

export default function App() {
  const [values, setValues] = useState<QueryPanelValues>(INITIAL_VALUES);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<RetrievalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = status === 'running';
  const hasRun = status === 'done' && (result !== null || error !== null);
  const examples = values.mode === 'demo' ? DEMO_EXAMPLES : LIVE_EXAMPLES;
  const timeline = useMemo(() => (result ? buildTimeline(result.trace) : []), [result]);

  const announcement = useMemo(() => {
    if (running) {
      return 'Running. Reading sources.';
    }
    if (error) {
      return `The run stopped unexpectedly. ${error}`;
    }
    if (!result) {
      return '';
    }
    if (result.abstained) {
      return `No answer. ${describeAbstention(result.abstainReason).title}.`;
    }
    const sources = new Set(result.evidence.map((item) => item.sourceUrl)).size;
    return `Answer found: ${result.answer}. ${evidenceSummary(result.evidence, sources)}`;
  }, [running, error, result]);

  function handleChange(patch: Partial<QueryPanelValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function handleUseExample(example: Example) {
    setValues((current) => ({ ...current, question: example.question, startUrl: example.startUrl ?? '' }));
  }

  async function handleSubmit() {
    const question = values.question.trim();
    if (!question || running) {
      return;
    }

    setStatus('running');
    setResult(null);
    setError(null);

    try {
      const response = await runQuery(
        {
          question,
          startUrl: values.startUrl.trim() || undefined,
          options: {
            maxPages: values.maxPages,
            maxDepth: values.maxDepth,
            allowSearch: values.allowSearch,
          },
        },
        values.mode,
      );
      setResult(response);
    } catch {
      // The engine is built never to throw, so reaching here means something
      // outside it failed. Say so plainly rather than showing the raw error.
      setError('That run stopped unexpectedly. Nothing was saved — try again, or switch the source mode.');
    } finally {
      setStatus('done');
    }
  }

  const corsBlocked = values.mode === 'live' && (result?.sources ?? []).some((source) => source.error === 'network');

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">WebScout</p>
          <h1 className="font-heading text-3xl font-extrabold leading-tight sm:text-4xl">
            Source-grounded answers, or an honest refusal.
          </h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Ask a question. WebScout reads pages, finds the passage that answers it, and quotes it back with the exact
            location. When the sources don&rsquo;t answer the question, it abstains and says so — it never guesses.
          </p>
        </header>

        <main className="mt-8 space-y-6">
          <QueryPanel
            values={values}
            onChange={handleChange}
            onSubmit={handleSubmit}
            running={running}
            examples={examples}
            onUseExample={handleUseExample}
          />

          {/* One polite live region for the whole result, rather than several noisy ones. */}
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </p>

          {running ? <PipelineTimeline rows={[]} running /> : null}

          {error ? (
            <section role="alert" className="ws-reveal rounded-2xl border border-destructive/40 bg-destructive/10 p-5 sm:p-6">
              <h2 className="font-heading text-lg font-bold text-destructive">That run stopped unexpectedly</h2>
              <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/90">{error}</p>
            </section>
          ) : null}

          {!running && !hasRun ? (
            <section className="rounded-2xl border border-dashed border-border/60 p-5 sm:p-6">
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Nothing run yet
              </h2>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Pick a starter above, or ask your own question. Every answer comes back quoted from a page WebScout
                actually read, with the location it was found in — and if there is no such page, you get a refusal
                instead of a confident mistake.
              </p>
            </section>
          ) : null}

          {result && !running ? (
            <>
              <PipelineTimeline rows={timeline} running={false} />
              <AnswerCard response={result} />

              {corsBlocked ? (
                <section className="rounded-2xl border border-border/60 bg-primary/40 p-5 sm:p-6">
                  <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Why a source failed
                  </h2>
                  <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                    A browser can only read pages that explicitly allow it, and most sites don&rsquo;t — so a live run
                    here reaches a small set of hosts and reports the rest as unreachable. Server-side retrieval
                    removes that limit; it is the next piece of work, and the engine needs no changes for it.
                  </p>
                </section>
              ) : null}

              <EvidenceList evidence={result.evidence} linkable={values.mode === 'live'} />
              <SourcesPanel sources={result.sources} linkable={values.mode === 'live'} />

              {values.mode === 'demo' ? (
                <p className="px-1 text-xs leading-relaxed text-muted-foreground">{DEMO_SNAPSHOT_NOTE}</p>
              ) : null}
            </>
          ) : null}
        </main>

        <footer className="mt-12 border-t border-border/40 pt-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Deterministic and extractive: no language model, no API key, no credentials. An answer is only returned if
            the exact string can be found again in the page it cites.
          </p>
        </footer>
      </div>
    </div>
  );
}
