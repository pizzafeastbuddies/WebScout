/**
 * Scoring rules used by the AMD AI League matches 2 and 3, as published in their
 * briefs. The Match 4 brief is not public, so this is an ASSUMPTION kept in one
 * place: if Match 4 differs, change it here and re-run the benchmark.
 *
 * Normalisation: uppercase, remove all whitespace, remove the characters - . · _
 */
export function normalizeAnswer(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/\s+/g, '').replace(/[-.\u00B7_]/g, '');
}

/** An answer passes when it equals any accepted value after normalisation. */
export function isCorrect(answer: string | null | undefined, accepted: readonly string[]): boolean {
  const got = normalizeAnswer(answer);
  return accepted.some((item) => normalizeAnswer(item) === got);
}

/** An unanswerable question is expected to produce an empty answer. */
export function isUnanswerable(accepted: readonly string[]): boolean {
  return accepted.length > 0 && accepted.every((item) => normalizeAnswer(item) === '');
}
