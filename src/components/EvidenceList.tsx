import type { Evidence } from '../../engine/types';
import { describeLocator, hostOf, pathOf } from '../lib/display';
import { ExternalLinkIcon, QuoteIcon } from './icons';

interface EvidenceListProps {
  evidence: readonly Evidence[];
  /** False in demo mode, where the source addresses are illustrative. */
  linkable: boolean;
}

/**
 * The evidence, which is the actual deliverable.
 *
 * Two details carry the weight here. The snippet is rendered verbatim — the exact
 * string the engine matched, never reflowed or trimmed — and the locator says where
 * in the document it came from, down to the row and column header for a table
 * cell. A reader who cannot check the claim has not been given an answer, only an
 * assertion.
 */
export function EvidenceList({ evidence, linkable }: EvidenceListProps) {
  return (
    <section aria-labelledby="evidence-heading" className="rounded-2xl border border-border/60 bg-primary/40 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="evidence-heading" className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Evidence
        </h2>
        <span className="text-xs text-muted-foreground">
          {evidence.length === 1 ? '1 passage' : `${evidence.length} passages`}
        </span>
      </div>

      {evidence.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No passage survived verification, so nothing is quoted here. That is deliberate.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {evidence.map((item, index) => (
            <li key={item.id} className="ws-reveal" style={{ animationDelay: `${index * 40}ms` }}>
              <article className="rounded-xl border border-border/60 bg-background/40 p-4">
                <div className="flex items-start gap-2.5">
                  <QuoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <blockquote className="ws-quote text-[15px] leading-relaxed break-words">{item.snippet}</blockquote>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  <span>{describeLocator(item.locator)}</span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5">
                    {item.matchType === 'exact' ? 'Exact match' : 'Normalised match'}
                  </span>
                </div>

                <div className="mt-3 border-t border-border/40 pt-3">
                  {linkable ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex max-w-full items-center gap-2 text-xs text-accent transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <span className="font-medium">{hostOf(item.sourceUrl)}</span>
                      <span className="truncate text-muted-foreground">{pathOf(item.sourceUrl)}</span>
                      <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{hostOf(item.sourceUrl)}</span>
                      {pathOf(item.sourceUrl)} · saved snapshot
                    </p>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
