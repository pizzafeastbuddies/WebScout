import type { AnswerType } from '../types';
import { normalizeForMatch } from '../util/text';

/**
 * Answer shaping: trims a verified answer to the value that was asked for.
 *
 * Every function here only ever REMOVES text from an answer that already passed the
 * grounding gate, and the caller re-checks that the shortened answer still occurs in
 * the snippet. So shaping can make an answer tighter but never invent one.
 */

/** Wikipedia-style reference marks: [3], [a], [note 2], [citation needed]. */
const CITATION_MARK = /\s*\[(?:\d{1,3}|[a-z]|note \d{1,2}|citation needed|[a-z]{1,3} \d{1,2})\]/gi;

export function stripCitationMarks(value: string): string {
  return value.replace(CITATION_MARK, '').replace(/\s{2,}/g, ' ').trim();
}

const YEAR_QUESTION = /\b(?:what|which|in what|in which)\s+year\b|\bwhat\s+year\b|\byear\s+(?:did|was|were|is)\b/;
const YEAR = /\b(1\d{3}|20\d{2})\b/;

/** True when the question wants a year, not a full date. */
export function asksForYear(question: string): boolean {
  return YEAR_QUESTION.test(normalizeForMatch(question));
}

/** "9 November 1989" answers "in what year ...?" with "1989". */
export function reduceToYear(value: string): string {
  return value.match(YEAR)?.[1] ?? value;
}

export function shapeAnswer(question: string, answerType: AnswerType, answer: string): string {
  let shaped = stripCitationMarks(answer);
  if (answerType === 'date' && asksForYear(question)) {
    shaped = reduceToYear(shaped);
  }
  return shaped || answer;
}
