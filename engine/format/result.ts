import { MAX_EVIDENCE_ITEMS, type RetrievalResponse } from '../contract/internal';
import type { Understanding } from '../query/understand';
import type { AnswerType, Evidence, SourceReport, TraceEvent } from '../types';
import { round } from '../util/text';
import type { RejectedCandidate, VerifiedCandidate } from '../answer/verify';

/**
 * Turns verified candidates into the response the contract promises.
 *
 * Two decisions worth stating:
 *
 *  - **Answer type is reported from the evidence, not from the question.** If the
 *    winning candidate is a table cell, the result says `table_cell` even when the
 *    question was phrased as a plain fact, because that is what the answer actually
 *    is and what a reviewer will see.
 *  - **The answer is the top-ranked candidate, and every agreeing candidate supports
 *    it.** A candidate that disagrees from a *different source* is kept as
 *    contradicting evidence and costs confidence — the engine reports a conflict
 *    rather than silently picking a winner.
 */

export interface FormatInput {
  question: string;
  understanding: Understanding;
  /** Ordered by score, strongest first, as produced by the verification stage. */
  verified: VerifiedCandidate[];
  rejected: RejectedCandidate[];
  sources: SourceReport[];
  trace: TraceEvent[];
  /** True when a different source offered a different answer at a comparable score. */
  conflict: boolean;
}

function evidenceKindToAnswerType(candidate: VerifiedCandidate, fallback: AnswerType): AnswerType {
  return candidate.candidate.locator.kind === 'table' ? 'table_cell' : fallback;
}

function toEvidence(item: VerifiedCandidate, index: number): Evidence {
  return {
    id: `ev-${index + 1}`,
    snippet: item.candidate.text,
    sourceUrl: item.candidate.sourceUrl,
    locator: item.candidate.locator,
    matchType: item.matchType,
    score: round(item.score, 2),
  };
}

function confidenceFor(best: VerifiedCandidate, supportCount: number, conflict: boolean): number {
  let value = best.matchType === 'exact' ? 0.6 : 0.45;
  value += Math.min(best.matchedKeywords.length * 0.06, 0.18);
  if (supportCount > 1) {
    value += 0.08;
  }
  if (best.candidate.locator.kind !== 'text') {
    value += 0.08;
  }
  if (conflict) {
    value -= 0.2;
  }
  return round(Math.min(0.97, Math.max(0.05, value)));
}

export function formatResponse(input: FormatInput): RetrievalResponse {
  const best = input.verified[0];
  if (!best) {
    // Callers are expected to abstain before reaching here; this keeps the
    // invariant honest if one does not.
    return {
      question: input.question,
      answer: null,
      answerType: input.understanding.answerType,
      confidence: 0,
      abstained: true,
      abstainReason: 'no_evidence',
      evidence: [],
      sources: input.sources,
      trace: input.trace,
    };
  }

  const supporting = input.verified.filter((item) => item.answer === best.answer);
  const contradicting = input.verified.filter(
    (item) => item.answer !== best.answer && item.candidate.sourceUrl !== best.candidate.sourceUrl,
  );

  const evidence = [...supporting, ...(input.conflict ? contradicting : [])]
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map(toEvidence);

  return {
    question: input.question,
    answer: best.answer,
    answerType: evidenceKindToAnswerType(best, input.understanding.answerType),
    confidence: confidenceFor(best, supporting.length, input.conflict),
    abstained: false,
    evidence,
    sources: input.sources,
    trace: input.trace,
  };
}
