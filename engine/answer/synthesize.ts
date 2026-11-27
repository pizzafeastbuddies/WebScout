import type { LLMAdapter } from '../adapters/llm';
import type { Understanding } from '../query/understand';
import { matchesAnswerType } from './answerType';
import { shapeAnswer } from './shape';
import { groundAnswer, type VerifiedCandidate } from './verify';

/**
 * Optional model step: lets a language model pick the exact VALUE out of passages
 * the extractive pipeline already verified.
 *
 * The model cannot add facts. A claim is accepted only if
 *   1. it cites a passage we sent,
 *   2. its text occurs in that passage (exactly or after case/space folding), and
 *   3. its text occurs in the full text of the page that passage came from.
 * Anything else is dropped. If no claim survives, the caller abstains.
 */

/** How many verified passages are shown to the model. Small on purpose: latency and focus. */
export const MAX_MODEL_PASSAGES = 8;

export type ModelOutcome =
  | { kind: 'skipped' } // no model, or it could not respond: use the extractive answer
  | { kind: 'declined'; reason: string } // it responded but nothing grounded survived: abstain
  | { kind: 'answered'; best: VerifiedCandidate; ranked: VerifiedCandidate[]; evidenceId: string };

function passageText(item: VerifiedCandidate): string {
  const { candidate } = item;
  return candidate.context ? `${candidate.context} | ${candidate.text}` : candidate.text;
}

export async function selectWithModel(
  llm: LLMAdapter | undefined,
  understanding: Understanding,
  verified: readonly VerifiedCandidate[],
  pageText: (sourceUrl: string) => string,
): Promise<ModelOutcome> {
  if (!llm || !llm.enabled || verified.length === 0) {
    return { kind: 'skipped' };
  }

  const shown: VerifiedCandidate[] = [];
  const seen = new Set<string>();
  for (const item of verified) {
    const key = `${item.candidate.sourceUrl}\n${passageText(item)}`;
    if (!seen.has(key)) {
      seen.add(key);
      shown.push(item);
    }
    if (shown.length >= MAX_MODEL_PASSAGES) {
      break;
    }
  }

  let result;
  try {
    result = await llm.synthesize({
      question: understanding.question,
      answerType: understanding.answerType,
      passages: shown.map((item, index) => ({ evidenceId: `ev-${index + 1}`, text: passageText(item) })),
    });
  } catch {
    return { kind: 'skipped' };
  }
  if (result === null) {
    return { kind: 'skipped' };
  }

  for (const claim of result.claims) {
    for (const id of claim.evidenceIds) {
      const index = Number(id.replace(/^ev-/, '')) - 1;
      const source = shown[index];
      if (!source) {
        continue;
      }
      const answer = shapeAnswer(understanding.question, understanding.answerType, claim.text);
      if (!answer || !matchesAnswerType(answer, understanding.answerType)) {
        continue;
      }
      const inPassage = groundAnswer(answer, passageText(source));
      const inPage = groundAnswer(answer, pageText(source.candidate.sourceUrl));
      if (!inPassage.ok || !inPage.ok) {
        continue;
      }
      const best: VerifiedCandidate = {
        ...source,
        answer,
        matchType: inPassage.matchType === 'exact' && inPage.matchType === 'exact' ? 'exact' : 'normalised',
      };
      return { kind: 'answered', best, ranked: [best, ...verified.filter((item) => item !== source)], evidenceId: id };
    }
  }

  return { kind: 'declined', reason: 'the model returned no value that is present in the retrieved evidence' };
}
