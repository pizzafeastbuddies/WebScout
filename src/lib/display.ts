import type { RetrievalOptions } from '../../engine/contract/internal';
import type { AbstainReason, AnswerType, Evidence, Locator, SourceReport, TraceEvent, TraceStage } from '../../engine/types';

/**
 * Presentation helpers.
 *
 * The rule this file exists to enforce: the UI never shows a raw engine value.
 * `no_evidence`, `budget_exhausted` and `table_cell` are precise for the engine and
 * meaningless to a reader, so every enum crossing into the interface is translated
 * here, in one place, rather than being sprinkled through components.
 */

export interface Example { label: string; question: string; startUrl?: string }

export const STAGE_ORDER: TraceStage[] = ['understand', 'discover', 'fetch', 'extract', 'select', 'verify', 'format'];

const STAGE_LABELS: Record<TraceStage, string> = {
  understand: 'Understand the question',
  discover: 'Find candidate pages',
  fetch: 'Read the pages',
  extract: 'Pull out passages',
  select: 'Rank the passages',
  verify: 'Check every answer',
  format: 'Assemble the result',
};

export type StageState = 'done' | 'failed' | 'skipped' | 'pending';

export interface StageRow {
  stage: TraceStage;
  label: string;
  state: StageState;
  details: string[];
  counts?: Record<string, number>;
}

const COUNT_LABELS: Record<string, { singular: string; plural: string }> = {
  keywords: { singular: 'keyword', plural: 'keywords' },
  seeds: { singular: 'seed', plural: 'seeds' },
  fetched: { singular: 'page read', plural: 'pages read' },
  failed: { singular: 'failure', plural: 'failures' },
  candidates: { singular: 'passage', plural: 'passages' },
  shortlisted: { singular: 'ranked', plural: 'ranked' },
  accepted: { singular: 'grounded', plural: 'grounded' },
  rejected: { singular: 'rejected', plural: 'rejected' },
};

function describeCount(key: string, value: number): string {
  const labels = COUNT_LABELS[key];
  if (!labels) {
    return `${value} ${key}`;
  }
  return `${value} ${value === 1 ? labels.singular : labels.plural}`;
}

/**
 * Collapses the trace into one row per stage.
 *
 * A stage can appear several times (verification reports its rejections in a
 * follow-up event), so the events are aggregated rather than listed: a single
 * failure anywhere in a stage makes the stage failed, because that is what
 * determined the outcome.
 */
export function buildTimeline(trace: readonly TraceEvent[]): StageRow[] {
  return STAGE_ORDER.map((stage) => {
    const events = trace.filter((event) => event.stage === stage);
    const state: StageState = events.some((event) => event.status === 'failed')
      ? 'failed'
      : events.some((event) => event.status === 'ok')
        ? 'done'
        : events.some((event) => event.status === 'skipped')
          ? 'skipped'
          : 'pending';

    const counts: Record<string, number> = {};
    for (const event of events) {
      if (event.counts) {
        for (const [key, value] of Object.entries(event.counts)) {
          if (typeof value === 'number' && value > 0) {
            counts[key] = value;
          }
        }
      }
    }

    return {
      stage,
      label: STAGE_LABELS[stage],
      state,
      details: events.map((event) => event.detail).filter(Boolean),
      counts: Object.keys(counts).length > 0 ? counts : undefined,
    };
  });
}

export function describeCounts(counts: Record<string, number>): string[] {
  return Object.entries(counts).map(([key, value]) => describeCount(key, value));
}

const ABSTAIN_COPY: Record<AbstainReason, { title: string; body: string }> = {
  no_sources: {
    title: 'No sources to read',
    body: 'Nothing was available to look at — no start URL was given and the search found no usable pages. Give WebScout a page to start from, or allow search.',
  },
  no_evidence: {
    title: 'The answer is not in these sources',
    body: 'Pages were read successfully, but none of them states the answer to this question. WebScout will not guess — that is the point.',
  },
  contradictory_evidence: {
    title: 'The sources disagree',
    body: 'Two sources answer this question equally well and give different answers, so there is no defensible way to choose between them. Both are shown below.',
  },
  fetch_failed: {
    title: 'Nothing could be read',
    body: 'Every source failed to load. See the source list for why each one failed — a timeout or a blocked request here is a fact about the site, not a bug.',
  },
};

export function describeAbstention(reason: AbstainReason | undefined): { title: string; body: string } {
  if (!reason) {
    return { title: 'No answer', body: 'No grounded answer was produced.' };
  }
  return ABSTAIN_COPY[reason];
}

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  fact: 'Fact',
  version: 'Version',
  date: 'Date',
  number: 'Number',
  table_cell: 'Table cell',
  list: 'List',
  comparison: 'Comparison',
  unknown: 'Unclassified',
};

export function describeAnswerType(type: AnswerType): string {
  return ANSWER_TYPE_LABELS[type];
}

export function confidenceBand(value: number): string {
  if (value >= 0.8) return 'Very strong';
  if (value >= 0.65) return 'Strong';
  if (value >= 0.45) return 'Moderate';
  return 'Weak';
}

export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}% · ${confidenceBand(value)}`;
}

/** A human-readable description of where an answer came from. */
export function describeLocator(locator: Locator): string {
  const parts: string[] = [];
  if (locator.kind === 'table') {
    parts.push('Table');
  } else if (locator.kind === 'structured') {
    parts.push('Structured data');
  } else {
    parts.push('Passage');
  }
  if (locator.section) {
    parts.push(`section “${locator.section}”`);
  }
  if (locator.rowHeader) {
    parts.push(`row “${locator.rowHeader}”`);
  }
  if (locator.columnHeader) {
    parts.push(`column “${locator.columnHeader}”`);
  }
  if (locator.jsonPointer) {
    parts.push(`at ${locator.jsonPointer}`);
  }
  return parts.join(' · ');
}

const SOURCE_STATUS_COPY: Record<SourceReport['status'], string> = {
  fetched: 'Read',
  failed: 'Failed',
  skipped: 'Not read',
};

export function describeSourceStatus(status: SourceReport['status']): string {
  return SOURCE_STATUS_COPY[status];
}

const FETCH_ERROR_COPY: Record<string, string> = {
  timeout: 'timed out',
  not_found: 'not found (404)',
  forbidden: 'refused access (403)',
  disallowed: 'blocked by robots.txt',
  too_large: 'too large to read',
  non_html: 'not an HTML page',
  too_many_redirects: 'too many redirects',
  budget_exhausted: 'left unread — page limit reached',
  unsupported_scheme: 'not an http address',
  network: 'could not be reached',
};

export function describeFetchError(error: string | undefined): string | undefined {
  if (!error) {
    return undefined;
  }
  return FETCH_ERROR_COPY[error] ?? error;
}

/** The host, so a long URL does not dominate the layout. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

export function evidenceSummary(evidence: readonly Evidence[], sourceCount: number): string {
  const passages = evidence.length === 1 ? '1 passage' : `${evidence.length} passages`;
  const sources = sourceCount === 1 ? '1 source' : `${sourceCount} sources`;
  return `Grounded in ${passages} from ${sources}.`;
}

export const ADVANCED_DEFAULTS: RetrievalOptions = {
  maxPages: 5,
  maxDepth: 1,
  allowSearch: true,
  timeoutMs: 10_000,
  searchProvider: 'wikimedia',
};
