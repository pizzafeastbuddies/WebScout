import type { LLMAdapter } from '../adapters/llm';
import type { SearchProvider, SearchProviderId } from '../discovery/search';
import type { Fetcher } from '../fetch/fetcher';
import type { AbstainReason, AnswerType, Evidence, SourceReport, TraceEvent } from '../types';

/**
 * The neutral internal contract.
 *
 * This is the frozen boundary between the engine and everything around it: the
 * React UI, the Supabase Edge Function, the fixture tests, and â€?later â€?the Match
 * 4 harness adapter. Callers hand in a `RetrievalRequest`, they get back a
 * `RetrievalResponse`, and nothing else in the engine's implementation is exposed.
 *
 * Keeping this contract neutral is what allows the same engine to run in the
 * browser, in Deno, and in the AMD container, and it is what confines the
 * unverified Match 4 schema to a single future adapter file
 * (`engine/contract/match4.ts`) instead of leaking through the whole codebase.
 */

/** How much work one run is allowed to do. All values are resolved and clamped before use. */
export interface RetrievalOptions {
  /** Maximum number of pages to fetch in one run. */
  maxPages: number;
  /** How many link hops to follow from the seed URL. 0 means read the seed only. */
  maxDepth: number;
  /** Whether a question without a start URL may use a search provider to find pages. */
  allowSearch: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Which search backend to use when discovery is needed. */
  searchProvider: SearchProviderId;
}

export const DEFAULT_RETRIEVAL_OPTIONS: RetrievalOptions = {
  maxPages: 5,
  maxDepth: 1,
  allowSearch: true,
  timeoutMs: 10_000,
  searchProvider: 'wikimedia',
};

/**
 * Hard bounds. These exist so that a bad value from a UI field or a future harness
 * cannot turn into an unbounded crawl.
 */
export const OPTION_BOUNDS = {
  maxPages: { min: 1, max: 25 },
  maxDepth: { min: 0, max: 3 },
  timeoutMs: { min: 500, max: 60_000 },
} as const;

/** Engine-wide caps that keep evidence and snippets a sane size in a UI. */
export const MAX_CANDIDATES_PER_SOURCE = 400;
export const MAX_EVIDENCE_ITEMS = 12;
export const MAX_SNIPPET_CHARS = 320;

export interface RetrievalRequest {
  question: string;
  /** Optional seed. When absent, the engine must discover pages via search. */
  startUrl?: string;
  options?: Partial<RetrievalOptions>;
}

export interface ResolvedRetrievalRequest {
  question: string;
  startUrl?: string;
  options: RetrievalOptions;
}

/** Everything the engine needs, injected. The engine constructs none of these itself. */
export interface EngineDeps {
  fetcher: Fetcher;
  /**
   * Providers keyed by id. Optional because a run with a start URL needs no search
   * at all, and because a disabled provider must degrade to abstention rather than
   * a crash.
   */
  searchProviders?: Partial<Record<SearchProviderId, SearchProvider>>;
  /** Optional. When absent the engine uses the extractive path only. */
  llm?: LLMAdapter;
}

/**
 * The engine's result. Abstention is a normal, fully-populated outcome â€?not an
 * error, and never a bare empty string.
 */
export interface RetrievalResponse {
  question: string;
  /** `null` exactly when the engine abstained. Never a guess. */
  answer: string | null;
  answerType: AnswerType;
  /** 0..1. Reflects grounding strength, not model confidence. */
  confidence: number;
  abstained: boolean;
  abstainReason?: AbstainReason;
  /** Every passage supporting the answer, each locatable in its source. */
  evidence: Evidence[];
  /** Per-URL outcome, so any result or abstention can be audited. */
  sources: SourceReport[];
  /** Stage-by-stage trail, surfaced in the UI as a progress timeline. */
  trace: TraceEvent[];
}

/**
 * The engine entrypoint signature. Implemented by `engine/run/pipeline.ts` (task 2)
 * and called by every transport: in-browser, Edge Function, or test harness.
 */
export type RetrievalRunner = (
  request: RetrievalRequest,
  deps: EngineDeps,
) => Promise<RetrievalResponse>;

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Applies defaults, clamps to `OPTION_BOUNDS`, and discards junk numeric input. */
export function resolveOptions(overrides: Partial<RetrievalOptions> = {}): RetrievalOptions {
  return {
    maxPages: clamp(
      overrides.maxPages,
      OPTION_BOUNDS.maxPages.min,
      OPTION_BOUNDS.maxPages.max,
      DEFAULT_RETRIEVAL_OPTIONS.maxPages,
    ),
    maxDepth: clamp(
      overrides.maxDepth,
      OPTION_BOUNDS.maxDepth.min,
      OPTION_BOUNDS.maxDepth.max,
      DEFAULT_RETRIEVAL_OPTIONS.maxDepth,
    ),
    allowSearch: overrides.allowSearch ?? DEFAULT_RETRIEVAL_OPTIONS.allowSearch,
    timeoutMs: clamp(
      overrides.timeoutMs,
      OPTION_BOUNDS.timeoutMs.min,
      OPTION_BOUNDS.timeoutMs.max,
      DEFAULT_RETRIEVAL_OPTIONS.timeoutMs,
    ),
    searchProvider: overrides.searchProvider ?? DEFAULT_RETRIEVAL_OPTIONS.searchProvider,
  };
}

/**
 * Normalises a caller-supplied request. An empty or whitespace-only `startUrl`
 * is treated as absent, so `allowSearch` discovery kicks in rather than the run
 * failing on a blank fetch.
 */
export function resolveRetrievalRequest(request: RetrievalRequest): ResolvedRetrievalRequest {
  const question = request.question.trim();
  const startUrl = request.startUrl?.trim();
  return {
    question,
    startUrl: startUrl ? startUrl : undefined,
    options: resolveOptions(request.options),
  };
}
