import { describeCounts, type StageRow } from '../lib/display';
import { CheckIcon, CrossIcon, MinusIcon } from './icons';

interface PipelineTimelineProps {
  rows: StageRow[];
  running: boolean;
}

function StageIcon({ state }: { state: StageRow['state'] }) {
  if (state === 'done') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <CrossIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === 'skipped') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MinusIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/70" />;
}

/**
 * The run, replayed stage by stage.
 *
 * Progress is not streamed — the whole trace arrives with the response — so this
 * is a record rather than a live indicator. The counts are the point: "0 grounded,
 * 7 rejected" explains an abstention in a way that "no answer" never would.
 */
export function PipelineTimeline({ rows, running }: PipelineTimelineProps) {
  return (
    <section aria-labelledby="timeline-heading" className="rounded-2xl border border-border/60 bg-primary/40 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="timeline-heading" className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          What happened
        </h2>
        {running ? (
          <span className="text-xs text-muted-foreground">Running…</span>
        ) : (
          <span className="text-xs text-muted-foreground">{rows.length} stages</span>
        )}
      </div>

      {running ? (
        <div className="mt-4">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="ws-progress h-full w-1/3 rounded-full bg-accent" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Reading sources — this can take a moment.</p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {rows.map((row, index) => (
            <li
              key={row.stage}
              className="ws-reveal flex gap-3"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <StageIcon state={row.state} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {row.label}
                  {row.state === 'skipped' ? <span className="ml-2 text-xs font-normal text-muted-foreground">skipped</span> : null}
                </p>
                {row.details.length > 0 ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{row.details.join(' · ')}</p>
                ) : null}
                {row.counts ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {describeCounts(row.counts).map((count) => (
                      <li key={count} className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {count}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
