import type { AnswerType } from '../types';
import { contentTokens, normalizeForMatch } from '../util/text';

/**
 * What the engine decided the question is asking for.
 *
 * Deliberately small: an answer type and a bag of keywords. No model, no
 * paraphrase, no query rewriting. The challenge rewards accurate retrieval, and a
 * deterministic reading of the question is far easier to reason about when an
 * answer turns out to be wrong than a probabilistic one would be.
 */
export interface Understanding {
  /** The question exactly as supplied, trimmed by the contract layer. */
  question: string;
  /** Shapes which candidates can become answers, and is reported in the result. */
  answerType: AnswerType;
  /** Question terms that carry meaning. Empty means the question is unanswerable as posed. */
  keywords: string[];
}

const NUMBER_CUES = /\b(how (?:many|much|often)|number of|count(?:ed|s)?|total|sum of|percentage|percentage of|percent of)\b/;
const VERSION_CUES = /\b(version|versions|release number|build number|revision)\b/;
const DATE_CUES = /\b(when|what (?:year|date|day|month)|since when|as of|released|published|founded|established|inception|launched|introduced|discontinued)\b/;
const COMPARISON_CUES = /\b(difference|compared?|versus|vs\.?|higher|lower|faster|slower|larger|smaller|taller|heavier|more than|less than|older|newer)\b/;
const LIST_CUES = /\b(list|list all|which (?:of )?(?:the )?\w+s|name (?:the|all|any|some)|examples? of|what are the)\b/;

/**
 * Classifies the expected answer type, most specific cue first.
 *
 * "When was version 2.1 released?" contains both a version cue and a date cue;
 * version is checked first because that is the value the question is actually
 * after. Ordering here is the whole of the classification policy.
 */
export function classifyAnswerType(question: string): AnswerType {
  const normalised = normalizeForMatch(question);
  if (VERSION_CUES.test(normalised)) return 'version';
  if (NUMBER_CUES.test(normalised)) return 'number';
  if (DATE_CUES.test(normalised)) return 'date';
  if (COMPARISON_CUES.test(normalised)) return 'comparison';
  if (LIST_CUES.test(normalised)) return 'list';
  return 'fact';
}

export function understand(question: string): Understanding {
  const normalised = normalizeForMatch(question);
  return {
    question,
    answerType: classifyAnswerType(normalised),
    keywords: [...new Set(contentTokens(normalised))],
  };
}
