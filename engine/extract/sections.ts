import { collapseWhitespace, isElement, textContent, walk, type Document, type Node } from '../dom/parseHtml';

const HEADING_RE = /^h[1-6]$/;

/**
 * Maps every element to the nearest preceding heading, in one document-order pass.
 *
 * A locator that says only "in this document" is close to useless for a reviewer
 * staring at a long spec page; "in the section *Deployment by region*" is not. This
 * index is what makes `Locator.section` cheap to populate for text, table and
 * structured evidence alike, and doing it once per page keeps it deterministic.
 */
export function sectionIndex(doc: Document): Map<Node, string> {
  const index = new Map<Node, string>();
  let section = '';

  walk(doc, (node) => {
    if (!isElement(node)) {
      return;
    }
    if (HEADING_RE.test(node.tagName.toLowerCase())) {
      const heading = collapseWhitespace(textContent(node));
      if (heading) {
        section = heading;
      }
    }
    index.set(node, section);
  });

  return index;
}
