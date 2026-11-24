import type { AnswerType } from '../types';
import { normalizeForMatch } from '../util/text';

/**
 * What a value of each answer type looks like, and how a typed value is lifted out
 * of a longer passage.
 *
 * The extractive engine never rewrites text, so a `number` answer must be a
 * substring that already exists in the passage — this module only chooses *which*
 * substring. That is the difference between reporting "640 Gbit/s" and reporting a
 * whole sentence: both are grounded, but only one of them is an answer.
 */

const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?(?:\s?(?:%|per ?cent|percent|billion|million|thousand|bn|m|k))?/i;
const VERSION_PATTERN = /\bv?\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.]+)?\b/i;
const DATE_PATTERN = /\b(?:(?:19|20)\d{2}-\d{2}-\d{2}|(?:0?[1-9]|[12]\d|3[01])\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:19|20)?\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:0?[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}|(?:19|20)\d{2})\b/i;

/** `null` for types that have no distinct shape — `fact`, `list`, `comparison`, `unknown`. */
export function patternFor(answerType: AnswerType): RegExp | null {
  switch (answerType) {
    case 'number':
      return NUMBER_PATTERN;
    case 'version':
      return VERSION_PATTERN;
    case 'date':
      return DATE_PATTERN;
    default:
      return null;
  }
}

/**
 * Whether a string is even *shaped* like the answer the question wants.
 *
 * For an untyped question this is just "is there something here" — the ranking and
 * grounding stages carry the real weight. For a typed question it is a genuine
 * filter, and it is what rejects a candidate before the more expensive checks run.
 */
export function matchesAnswerType(value: string, answerType: AnswerType): boolean {
  const pattern = patternFor(answerType);
  if (pattern === null) {
    return normalizeForMatch(value).length > 0;
  }
  return pattern.test(value);
}

/**
 * The substring of `text` that answers a typed question, or `null` when the
 * passage does not contain one.
 *
 * Untyped questions return the passage unchanged: for those, the passage *is* the
 * answer, and trimming it to a fragment would produce a claim the source does not
 * make.
 */
export function deriveAnswer(text: string, answerType: AnswerType): string | null {
  const pattern = patternFor(answerType);
  if (pattern === null) {
    return normalizeForMatch(text).length > 0 ? text : null;
  }
  const match = text.match(pattern);
  return match ? match[0].trim() : null;
}
