/**
 * WebScout engine — shared domain types.
 *
 * ---------------------------------------------------------------------------
 * PORTABILITY (the central constraint of this project)
 * ---------------------------------------------------------------------------
 * Everything under `engine/` must run unchanged in three very different places:
 *
 *   1. the browser bundle (React app),
 *   2. a Supabase Edge Function (Deno),
 *   3. Node, inside the deterministic fixture tests.
 *
 * Therefore NOTHING under `engine/` may import `react`, anything from
 * `@supabase/*`, or any Node/Deno-only API (`node:*`, `fs`, `path`, `process`,
 * `Deno.*`). Only standard web APIs are allowed: `fetch`, `URL`, `Response`,
 * `TextEncoder`, `AbortController`, and the portable `parse5` parser via
 * `engine/dom/parseHtml.ts`.
 *
 * `engine/__tests__/foundation.test.ts` enforces this mechanically by scanning
 * every runtime file under `engine/`, so a violation fails the test suite rather
 * than being discovered later inside the AMD container.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------
 * No timestamps, durations or other wall-clock values appear anywhere in these
 * types. That is deliberate: a run over a fixed set of fixtures must produce an
 * identical response every time, which is impossible if the contract carries a
 * clock. Diagnostics that genuinely need timing belong in local logging, not in
 * the returned `RetrievalResponse`.
 */

/** What kind of thing the question is asking for. Drives answer selection and verification. */
export type AnswerType =
  | 'fact'
  | 'version'
  | 'date'
  | 'number'
  | 'table_cell'
  | 'list'
  | 'comparison'
  | 'unknown';

/**
 * Why the engine declined to answer. Abstention is a first-class, typed outcome —
 * never an empty answer and never an error. A wrong "no idea" is far cheaper than
 * a confident wrong answer.
 */
export type AbstainReason =
  /** Nothing was available to read: no start URL and search returned nothing usable. */
  | 'no_sources'
  /** Pages were read successfully, but none contained evidence for this question. */
  | 'no_evidence'
  /** Sources disagreed with each other; the engine will not pick a winner silently. */
  | 'contradictory_evidence'
  /** Every source failed to load (timeout, 403, offline, …). */
  | 'fetch_failed';

/** Where a piece of evidence came from. */
export type EvidenceKind = 'text' | 'table' | 'structured';

/** How the answer string was matched against the source. */
export type MatchType = 'exact' | 'normalised';

/**
 * Points back into the source document. This is what makes an answer auditable:
 * a reviewer can see exactly which cell, section or JSON pointer it came from.
 */
export interface Locator {
  kind: EvidenceKind;
  /** Nearest enclosing heading, e.g. "Deployment by region". */
  section?: string;
  /** For `kind: 'table'` — the row header, e.g. "Chile". */
  rowHeader?: string;
  /** For `kind: 'table'` — the column header, e.g. "Peak throughput". */
  columnHeader?: string;
  /** For `kind: 'structured'` — a JSON pointer into the JSON-LD block. */
  jsonPointer?: string;
}

/** A single grounded passage supporting (or contradicting) an answer. */
export interface Evidence {
  /** Stable, deterministic id (`ev-1`, `ev-2`, …) so claims can reference evidence. */
  id: string;
  /** The exact text lifted from the source. Must literally occur in the source document. */
  snippet: string;
  /** The URL the snippet was read from. */
  sourceUrl: string;
  locator: Locator;
  /** `exact` means byte-for-byte present; `normalised` means matched after whitespace/case folding. */
  matchType: MatchType;
  /** Relative retrieval score, higher is stronger. Optional — never used for grounding. */
  score?: number;
}

/**
 * Why a fetch did not yield readable HTML.
 *
 * If you add a member here, `engine/fetch/fixtureFetcher.ts` will fail to compile
 * until the corresponding default status is declared — that is intentional.
 */
export type FetchFailureReason =
  /** The request exceeded the per-request timeout. */
  | 'timeout'
  | 'not_found'
  | 'forbidden'
  /** `robots.txt` disallowed the path. */
  | 'disallowed'
  /** The response exceeded the byte cap. */
  | 'too_large'
  /** Reached us, but the content type was not HTML (PDF, image, JSON, …). */
  | 'non_html'
  | 'too_many_redirects'
  /** The per-run request budget was exhausted before this URL could be fetched. */
  | 'budget_exhausted'
  /** Not http/https (e.g. `mailto:`, `javascript:`). */
  | 'unsupported_scheme'
  /** DNS failure, TLS failure, connection reset, offline. */
  | 'network';

/** A page that was retrieved successfully. */
export interface FetchSuccess {
  ok: true;
  /** The URL we asked for. */
  requestedUrl: string;
  /** The URL we actually ended up on, after redirects. */
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
}

/** A page that could not be retrieved. Failures are values, never thrown exceptions. */
export interface FetchFailure {
  ok: false;
  requestedUrl: string;
  error: FetchFailureReason;
  /** HTTP status when one was received. Absent for timeouts and network failures. */
  status?: number;
  finalUrl?: string;
  contentType?: string;
  /** Human-readable context. For diagnostics only — never shown raw to a user. */
  detail?: string;
}

/**
 * A fetcher must never throw for a page it cannot retrieve; it returns a
 * `FetchFailure` so the pipeline can record the reason and carry on with other sources.
 */
export type FetchResult = FetchSuccess | FetchFailure;

export type SourceStatus = 'fetched' | 'failed' | 'skipped';

/** How the engine found this URL. */
export type SourceDiscovery = 'start_url' | 'search' | 'link';

/** Per-URL outcome, so an abstention can always be audited source by source. */
export interface SourceReport {
  url: string;
  status: SourceStatus;
  via: SourceDiscovery;
  finalUrl?: string;
  title?: string;
  error?: FetchFailureReason;
  httpStatus?: number;
  contentType?: string;
  bytes?: number;
  /** How many candidate passages extraction produced from this page. */
  candidatesFound?: number;
  /** How many of those survived the verification gate. */
  evidenceAccepted?: number;
  detail?: string;
}

/** The pipeline stages, in the order they run. */
export type TraceStage =
  | 'understand'
  | 'discover'
  | 'fetch'
  | 'extract'
  | 'select'
  | 'verify'
  | 'format';

export type TraceStatus = 'start' | 'ok' | 'skipped' | 'failed';

/**
 * One step of the run, surfaced to the UI as a progress/failure timeline.
 * Rejections at the verification gate are reported here, which is how the UI can
 * show *why* a candidate was discarded rather than the engine swallowing it.
 */
export interface TraceEvent {
  stage: TraceStage;
  status: TraceStatus;
  detail: string;
  /** Optional numeric detail, e.g. `{ pagesFetched: 2, candidates: 7 }`. */
  counts?: Record<string, number>;
}

/** A single result from a search provider. Array order is the ranking. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
