import type { SourceReport } from '../../engine/types';
import { describeFetchError, describeSourceStatus, hostOf, pathOf } from '../lib/display';

interface SourcesPanelProps {
  sources: readonly SourceReport[];
  linkable: boolean;
}

const STATUS_STYLES: Record<SourceReport['status'], string> = {
  fetched: 'border-accent/50 text-accent',
  failed: 'border-destructive/50 text-destructive',
  skipped: 'border-border/70 text-muted-foreground',
};

const VIA_COPY: Record<SourceReport['via'], string> = {
  start_url: 'start URL',
  search: 'search result',
  link: 'followed link',
};

/**
 * Every address the run touched, including the ones that went wrong.
 *
 * This panel is what makes an abstention auditable: when the answer is "nothing to
 * report", the only useful information is which sources were tried and how each one
 * failed. A run that quietly dropped a source would be impossible to trust.
 */
export function SourcesPanel({ sources, linkable }: SourcesPanelProps) {
  const failed = sources.filter((source) => source.status === 'failed').length;

  return (
    <section aria-labelledby="sources-heading" className="rounded-2xl border border-border/60 bg-primary/40 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="sources-heading" className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Sources
        </h2>
        <span className="text-xs text-muted-foreground">
          {sources.length} attempted{failed > 0 ? ` · ${failed} failed` : ''}
        </span>
      </div>

      {sources.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No source was attempted — the run stopped before anything was fetched.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/40">
          {sources.map((source) => (
            <li key={source.url} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                {linkable && source.status === 'fetched' ? (
                  <a
                    href={source.finalUrl ?? source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm font-medium text-accent transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {source.title ?? hostOf(source.url)}
                  </a>
                ) : (
                  <p className="text-sm font-medium">{source.title ?? hostOf(source.url)}</p>
                )}

                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {hostOf(source.url)}
                  {pathOf(source.url)}
                </p>

                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>found via {VIA_COPY[source.via]}</span>
                  {source.candidatesFound !== undefined ? <span>{source.candidatesFound} passages</span> : null}
                  {source.error ? <span>{describeFetchError(source.error)}</span> : null}
                  {source.httpStatus ? <span>HTTP {source.httpStatus}</span> : null}
                </p>
              </div>

              <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[source.status]}`}>
                {describeSourceStatus(source.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
