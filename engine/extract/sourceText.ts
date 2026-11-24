import { collapseWhitespace, findAll, getAttr, isElement, isTextNode, textContent, type Document } from '../dom/parseHtml';

/**
 * The full text a candidate is allowed to be grounded against.
 *
 * This is deliberately *broader* than the text a reader sees. Evidence may come
 * from JSON-LD and `<meta>` values, which never appear in `textContent` because it
 * excludes script content — but those values really are in the retrieved document,
 * so an answer drawn from them is grounded. If grounding were checked against
 * visible text alone, every structured-data answer would be discarded as
 * unverifiable.
 */
export function groundingText(doc: Document): string {
  const parts: string[] = [collapseWhitespace(textContent(doc))];

  for (const script of findAll(doc, 'script')) {
    const type = (getAttr(script, 'type') ?? '').toLowerCase();
    if (!type.includes('ld+json')) {
      continue;
    }
    let raw = '';
    for (const child of script.childNodes) {
      if (isTextNode(child)) {
        raw += child.value;
      }
    }
    if (raw.trim()) {
      parts.push(collapseWhitespace(raw));
    }
  }

  for (const meta of findAll(doc, 'meta')) {
    const content = getAttr(meta, 'content');
    if (content && content.trim()) {
      parts.push(collapseWhitespace(content));
    }
  }

  return parts.filter(Boolean).join(' ');
}

/** The document's `<title>`, for the sources panel. */
export function documentTitle(doc: Document): string | undefined {
  const title = findAll(doc, 'title').find((element) => isElement(element));
  if (!title) {
    return undefined;
  }
  const text = collapseWhitespace(textContent(title));
  return text || undefined;
}
