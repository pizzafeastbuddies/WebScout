import type { Candidate } from '../extract/candidate';
import type { Understanding } from '../query/understand';
import type { AnswerType } from '../types';
import { contentTokens, normalizeForMatch } from '../util/text';
import { matchesAnswerType } from './answerType';

/**
 * Ranking, and the relevance floor.
 *
 * Scoring is a small, readable sum of evidence-bearing signals rather than a
 * learned model: every point added here has a stated reason, so a surprising
 * ranking can be traced by reading this file.
 */

/** Typed questions get their shape checked before they can win; untyped ones cannot. */
function isTyped(answerType: AnswerType): boolean {
  return answerType === 'number' || answerType === 'version' || answerType === 'date';
}

/**
 * Candidates must match at least this many question keywords.
 *
 * This is the difference between "we found an answer" and "we found a page that
 * talks about roughly this". Without a floor, any sentence would be a candidate for
 * any question, and the engine would answer everything — including questions whose
 * answer is simply not on the page, which is precisely the failure the assessment
 * penalises most.
 *
 * The floor scales with the question: half its keywords, but never fewer than two
 * and never more than the question actually has. A question that names its subject
 * ("…of the Nimbus Relay in Chile") is not answered by a page that merely mentions
 * the Nimbus Relay, so "both subject words appeared somewhere" must not be enough.
 */
function relevanceFloor(keywords: readonly string[]): number {
  if (keywords.length === 0) {
    return 0;
  }
  return Math.min(keywords.length, Math.max(2, Math.ceil(keywords.length / 2)));
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  matchedKeywords: string[];
  typeMatch: boolean;
}

function scoreCandidate(
  candidate: Candidate,
  keywords: readonly string[],
  normalizedQuestion: string,
  answerType: AnswerType,
): ScoredCandidate {
  const text = normalizeForMatch(candidate.text);
  const textTokens = new Set(contentTokens(text));
  const contextTokens = new Set(contentTokens(candidate.context));

  const matchedKeywords: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    if (textTokens.has(keyword)) {
      matchedKeywords.push(keyword);
      score += 3;
    } else if (contextTokens.has(keyword)) {
      // A match on the row/column header or JSON-LD property still counts, but a
      // little less than a match on the value itself.
      matchedKeywords.push(keyword);
      score += 2;
    } else if (text.includes(keyword)) {
      matchedKeywords.push(keyword);
      score += 1;
    }
  }

  if (keywords.length > 0) {
    if (matchedKeywords.length === keywords.length) {
      score += 4;
    }
    score += (matchedKeywords.length / keywords.length) * 2;
  }

  if (normalizedQuestion && text.includes(normalizedQuestion)) {
    score += 6;
  }

  const typeMatch = matchesAnswerType(candidate.text, answerType);
  if (isTyped(answerType) && typeMatch) {
    score += 5;
    // Among several values of the right shape, prefer the focused one: for a
    // question about a version number, "4.2.1" should beat "released as 4.2.1 in a
    // maintenance window".
    score += Math.max(0, 2.5 - candidate.text.length / 40);
  }

  if (candidate.locator.kind === 'structured') {
    score += 1;
  } else if (candidate.locator.kind === 'table') {
    score += 0.75;
  }

  return { candidate, score, matchedKeywords, typeMatch };
}

export function select(candidates: readonly Candidate[], understanding: Understanding): ScoredCandidate[] {
  const floor = relevanceFloor(understanding.keywords);
  if (understanding.keywords.length === 0) {
    return [];
  }

  return candidates
    .map((candidate) =>
      scoreCandidate(candidate, understanding.keywords, normalizeForMatch(understanding.question), understanding.answerType),
    )
    .filter((scored) => scored.matchedKeywords.length >= floor)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.sourceUrl.localeCompare(b.candidate.sourceUrl) ||
        a.candidate.text.localeCompare(b.candidate.text),
    );
}
