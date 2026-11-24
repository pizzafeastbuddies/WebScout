import type { AnswerType } from '../types';

/**
 * Optional language-model synthesis.
 *
 * ---------------------------------------------------------------------------
 * THIS IS DELIBERATELY NOT USED BY THE MVP.
 * ---------------------------------------------------------------------------
 * WebScout's MVP is deterministic and extractive: answers are lifted verbatim from
 * retrieved pages, so every answer is locatable in its source. No model, no API
 * key, no secret, no paid API.
 *
 * The interface exists so a model can be added later WITHOUT touching the core
 * pipeline. It is shaped the way it is for one reason: a generated answer is only
 * trustworthy if it is tied to the exact evidence it came from. Every claim must
 * carry the ids of the evidence supporting it, and the pipeline re-checks those
 * strings against the evidence at the verification gate. A model therefore cannot
 * introduce an ungrounded answer, only a different reading of grounded text.
 */

/** A passage offered to the model, already retrieved and identified. */
export interface SynthesisPassage {
  /** Matches `Evidence.id` in the retrieval response. */
  evidenceId: string;
  text: string;
}

export interface SynthesisRequest {
  question: string;
  answerType: AnswerType;
  passages: SynthesisPassage[];
}

/** One assertion, which must cite the evidence that supports it. */
export interface SynthesisClaim {
  text: string;
  /** Must reference ids from `SynthesisRequest.passages`. Verified downstream. */
  evidenceIds: string[];
}

export interface SynthesisResult {
  claims: SynthesisClaim[];
}

export interface LLMAdapter {
  readonly id: string;
  /** `false` means the pipeline must not depend on synthesis succeeding. */
  readonly enabled: boolean;
  /** Resolves to `null` when the adapter cannot or should not synthesise. */
  synthesize(request: SynthesisRequest): Promise<SynthesisResult | null>;
}

/**
 * The only adapter the MVP ships. Always declines, which keeps the extractive path
 * the single code path through the pipeline.
 */
export class NoopLLMAdapter implements LLMAdapter {
  readonly id = 'noop';
  readonly enabled = false;

  async synthesize(_request: SynthesisRequest): Promise<SynthesisResult | null> {
    return null;
  }
}
