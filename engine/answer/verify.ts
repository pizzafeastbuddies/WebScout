import type { Candidate } from '../extract/candidate';
import type { AnswerType, MatchType } from '../types';
import { normalizeForMatch } from '../util/text';
import { deriveAnswer, matchesAnswerType } from './answerType';
import type { ScoredCandidate } from './select';

/**
 * The verification gate. Nothing reaches a caller without passing through here.
 *
 * Three independent checks, in increasing cost:
 *
 *   1. the extracted snippet must still be locatable in the retrieved document —
 *      this catches a candidate that extraction mangled, and it is the check that
 *      makes "the answer is grounded" a property of the code rather than a promise;
 *   2. the answer must have the shape the question asked for (a `number` question
 *      cannot be answered by a sentence);
 *   3. the answer string must occur inside the evidence snippet it cites.
 *
 * There is no bypass. If an LLM adapter is added later, its output is fed through
 * `groundAnswer` exactly like an extracted candidate, which is what makes a model
 * unable to introduce an ungrounded answer.
 */

export interface GroundingResult {
  ok: boolean;
  matchType: MatchType;
  reason?: string;
}

/**
 * Is `answer` present in `evidenceText`?
 *
 * An exact match is reported as such. A match that only survives case/whitespace
 * folding is reported as `normalised`, and the UI shows that distinction, because
 * "present but differently typeset" is weaker than "present verbatim".
 */
export function groundAnswer(answer: string, evidenceText: string): GroundingResult {
  if (!answer.trim()) {
    return { ok: false, matchType: 'normalised', reason: 'the answer was empty' };
  }
  if (evidenceText.includes(answer)) {
    return { ok: true, matchType: 'exact' };
  }
  if (normalizeForMatch(evidenceText).includes(normalizeForMatch(answer))) {
    return { ok: true, matchType: 'normalised' };
  }
  return { ok: false, matchType: 'normalised', reason: 'the answer text does not occur in its evidence' };
}

export interface VerifiedCandidate {
  candidate: Candidate;
  answer: string;
  answerType: AnswerType;
  matchType: MatchType;
  score: number;
  matchedKeywords: string[];
}

export interface RejectedCandidate {
  candidate: Candidate;
  answerType: AnswerType;
  /** Plain-language reason, surfaced in the trace so a rejection is auditable. */
  reason: string;
}

export function isRejected(
  verdict: VerifiedCandidate | RejectedCandidate,
): verdict is RejectedCandidate {
  return 'reason' in verdict;
}

export function verifyCandidate(
  scored: ScoredCandidate,
  answerType: AnswerType,
  /** The full grounding text of the page this candidate came from. */
  sourceText: string,
): VerifiedCandidate | RejectedCandidate {
  const { candidate } = scored;

  const inSource = groundAnswer(candidate.text, sourceText);
  if (!inSource.ok) {
    return { candidate, answerType, reason: `snippet is not locatable in the retrieved source: ${inSource.reason ?? 'unknown'}` };
  }

  const answer = deriveAnswer(candidate.text, answerType);
  if (answer === null) {
    return { candidate, answerType, reason: `no ${answerType} value appears in this passage` };
  }
  if (!matchesAnswerType(answer, answerType)) {
    return { candidate, answerType, reason: `the value does not look like a ${answerType}` };
  }

  const inSnippet = groundAnswer(answer, candidate.text);
  if (!inSnippet.ok) {
    return { candidate, answerType, reason: inSnippet.reason ?? 'the answer is not present in the passage' };
  }

  return {
    candidate,
    answer,
    answerType,
    matchType: inSnippet.matchType,
    score: scored.score,
    matchedKeywords: scored.matchedKeywords,
  };
}
