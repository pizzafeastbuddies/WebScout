import { MAX_CANDIDATES_PER_SOURCE, MAX_SNIPPET_CHARS } from '../contract/internal';
import { collapseWhitespace, isElement, textContent, walk, type Document, type Element, type ParentNode } from '../dom/parseHtml';
import { sentences, splitToLimit } from '../util/text';
import type { Candidate } from './candidate';
import { sectionIndex } from './sections';

/**
 * Prose extraction.
 *
 * Answers are pulled from sentence-sized units of the visible text. Anything a
 * reader would not read as prose is skipped — script and style content is already
 * excluded by `textContent`, and table cells are skipped here because
 * `tables.ts` extracts them with their row and column headers attached, which is
 * strictly more useful evidence than the bare cell.
 */
const PROSE_TAGS = new Set(['p', 'li', 'dd', 'dt', 'figcaption', 'blockquote', 'pre']);

/** True when the element sits inside a table, so `tables.ts` owns it instead. */
function insideTable(element: Element): boolean {
  let parent: ParentNode | null | undefined = element.parentNode;
  while (parent && isElement(parent)) {
    if (parent.tagName.toLowerCase() === 'table') {
      return true;
    }
    parent = parent.parentNode;
  }
  return false;
}

export function extractTextCandidates(doc: Document, sourceUrl: string): Candidate[] {
  const sections = sectionIndex(doc);
  const candidates: Candidate[] = [];

  walk(doc, (node) => {
    if (!isElement(node) || !PROSE_TAGS.has(node.tagName.toLowerCase()) || insideTable(node)) {
      return;
    }

    const text = collapseWhitespace(textContent(node));
    if (!text) {
      return;
    }

    const section = sections.get(node) ?? '';
    for (const sentence of sentences(text)) {
      for (const piece of splitToLimit(sentence, MAX_SNIPPET_CHARS)) {
        candidates.push({
          text: piece,
          sourceUrl,
          locator: section ? { kind: 'text', section } : { kind: 'text' },
          context: section,
        });
      }
    }
  });

  return candidates.slice(0, MAX_CANDIDATES_PER_SOURCE);
}
