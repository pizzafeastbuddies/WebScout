import type { Locator } from '../types';

/**
 * A potential answer, lifted whole from a source document.
 *
 * `text` is always a verbatim slice of the retrieved page — never normalised,
 * never paraphrased, never assembled from several places. This is the property the
 * verification gate relies on: an answer is only trustworthy if the exact string
 * can be found again in the document it supposedly came from.
 *
 * `context` exists for ranking only. It carries the structural labels a reader
 * would use to make sense of the value — the enclosing section, the row and column
 * headers of a table cell, the property name of a JSON-LD leaf — so a question
 * that names a row ("peak throughput **in Chile**") can match a value that does not
 * contain that word itself. It is never shown as evidence and never matched
 * against, so it cannot make an answer look grounded when it is not.
 */
export interface Candidate {
  /** Verbatim text. Assumed to occur in the source document. */
  text: string;
  /** The URL `text` was read from. */
  sourceUrl: string;
  /** Where in the document it came from, for auditability. */
  locator: Locator;
  /** Structural labels used for ranking only. */
  context: string;
}
