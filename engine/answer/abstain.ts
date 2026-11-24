import type { RetrievalResponse } from '../contract/internal';
import type { AbstainReason, AnswerType, Evidence, SourceReport, TraceEvent } from '../types';

/**
 * Abstention, as a first-class outcome.
 *
 * The whole point of this module is that it produces a *fully populated* response
 * with `answer: null` rather than an error, an empty string, or a thrown exception.
 * A caller can therefore treat abstention as an ordinary result: it renders, it
 * audits, and it names what was missing.
 */

export interface AbstainInput {
  question: string;
  answerType: AnswerType;
  reason: AbstainReason;
  sources: SourceReport[];
  trace: TraceEvent[];
  /** Partial evidence, when some was found but the run still could not answer. */
  evidence?: Evidence[];
  confidence?: number;
}

export function abstainResponse(input: AbstainInput): RetrievalResponse {
  return {
    question: input.question,
    answer: null,
    answerType: input.answerType,
    confidence: input.confidence ?? 0,
    abstained: true,
    abstainReason: input.reason,
    evidence: input.evidence ?? [],
    sources: input.sources,
    trace: input.trace,
  };
}
