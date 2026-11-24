/**
 * Text helpers shared by every stage of the engine.
 *
 * All of them are pure string functions with no runtime-specific behaviour, which
 * is what lets ranking, matching and grounding behave identically in the browser,
 * in Deno and in Node. Nothing here reads a clock, so two runs over the same
 * fixtures score candidates in exactly the same order.
 */

/** Words carrying no discriminative weight when matching a question against a page. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'with', 'as', 'by',
  'from', 'into', 'over', 'under', 'between', 'among', 'during', 'than', 'then',
  'that', 'this', 'these', 'those', 'it', 'its', 'there', 'their', 'them',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'does', 'do', 'did', 'can', 'could', 'should', 'would', 'will', 'shall',
  'may', 'might', 'must', 'have', 'has', 'had', 'i', 'we', 'you', 'they',
  'he', 'she', 'about', 'his', 'her', 'our', 'your', 'my', 'me', 'us',
  'no', 'not', 'only', 'also', 'any', 'all', 'some', 'more', 'most', 'such',
  'per', 'via', 's',
]);

/**
 * Folding used by the verification gate and by phrase matching.
 *
 * It must be *conservative*: it removes presentation differences (case, curly
 * quotes, non-breaking spaces, exotic dashes) but never rewrites words, because
 * a normalised match is still a claim that the answer is present in the evidence.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word-like token, keeping digits, dots, slashes and hyphens (versions, units, dates). */
export function tokenize(value: string): string[] {
  return normalizeForMatch(value)
    .split(/[^a-z0-9._/-]+/)
    .filter((token) => token.length > 0);
}

/** Tokens worth matching on: single characters and stopwords are dropped. */
export function contentTokens(value: string): string[] {
  return tokenize(value).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Splits prose into sentence-sized units.
 *
 * Sentences — not paragraphs — are the candidates a prose question is answered
 * from, because a paragraph is far more likely to contain unrelated facts, and a
 * reviewer checking an answer needs the smallest passage that supports it.
 */
export function sentences(value: string): string[] {
  const matches = value.match(/[^.!?]+[.!?]*/g);
  if (matches === null) {
    return value.trim() ? [value.trim()] : [];
  }
  return matches.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Breaks a sentence into pieces no longer than `max`, splitting on commas so the
 * pieces stay readable. Pieces that are still too long are dropped rather than
 * clipped: a clipped snippet would no longer literally occur in the source, and
 * every snippet must be quotable.
 */
export function splitToLimit(value: string, max: number): string[] {
  if (value.length <= max) {
    return value.length > 0 ? [value] : [];
  }

  const pieces: string[] = [];
  let buffer = '';
  for (const chunk of value.split(/,\s+/)) {
    const candidate = buffer ? `${buffer}, ${chunk}` : chunk;
    if (candidate.length > max && buffer) {
      pieces.push(buffer);
      buffer = chunk;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) {
    pieces.push(buffer);
  }
  return pieces.filter((piece) => piece.length > 0 && piece.length <= max);
}

/** Rounds to `digits` places, so a computed confidence is stable across runtimes. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
