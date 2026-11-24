import type { RetrievalResponse } from '../../engine/contract/internal';
import { describeAbstention, describeAnswerType, evidenceSummary, formatConfidence } from '../lib/display';
import { AlertIcon } from './icons';

interface AnswerCardProps {
  response: RetrievalResponse;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * The result.
 *
 * Abstention gets its own treatment rather than being shown as a failure. It is a
 * correct outcome — the engine declining to guess is the feature — so the copy is
 * calm and specific, and the tone is "here is what was missing", not "something
 * went wrong".
 */
export function AnswerCard({ response }: AnswerCardProps) {
  const sourceCount = new Set(response.sources.filter((source) => source.status === 'fetched').map((source) => source.url)).size;

  if (response.abstained) {
    const copy = describeAbstention(response.abstainReason);
    return (
      <section
        aria-labelledby="answer-heading"
        className="ws-reveal rounded-2xl border border-caution/40 bg-caution/10 p-5 sm:p-6"
      >
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-caution/20 text-caution">
            <AlertIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 id="answer-heading" className="font-heading text-lg font-bold text-caution">
              {copy.title}
            </h2>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/90">{copy.body}</p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Outcome" value="Abstained" />
          <Stat label="Reason" value={String(response.abstainReason ?? 'unknown').replace(/_/g, ' ')} />
          <Stat label="Sources read" value={String(sourceCount)} />
        </dl>
      </section>
    );
  }

  const confidencePercent = Math.round(response.confidence * 100);

  return (
    <section aria-labelledby="answer-heading" className="ws-reveal rounded-2xl border border-accent/40 bg-primary/60 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="answer-heading" className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Answer
        </h2>
        <span className="rounded-full border border-accent/50 px-2.5 py-0.5 text-[11px] font-medium text-accent">
          {describeAnswerType(response.answerType)}
        </span>
      </div>

      <p className="mt-3 font-heading text-2xl font-bold leading-snug break-words sm:text-3xl">{response.answer}</p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</span>
          <span className="text-xs text-muted-foreground">{formatConfidence(response.confidence)}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${confidencePercent}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        {evidenceSummary(response.evidence, sourceCount)}
      </p>
    </section>
  );
}
