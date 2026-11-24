import { parse, parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

/**
 * The single seam between the engine and HTML parsing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The obvious way to read HTML is the browser's `DOMParser`. It is the wrong
 * choice here: `DOMParser` does not exist in Node and is not reliably available in
 * Deno, so using it would make the engine work in the browser and fail inside the
 * Supabase Edge Function and the fixture tests.
 *
 * The engine therefore uses `parse5`, a spec-compliant, dependency-free, pure-JS
 * parser that runs unchanged in all three runtimes and tolerates the malformed
 * markup real websites actually serve. Keeping it behind this one module means
 * swapping parser later (or replacing it with a native one inside the AMD
 * container) touches a single file rather than every extraction module.
 *
 * Extraction code imports tree types and helpers from here, never from `parse5`
 * directly.
 */

export type Document = DefaultTreeAdapterMap['document'];
export type DocumentFragment = DefaultTreeAdapterMap['documentFragment'];
export type Element = DefaultTreeAdapterMap['element'];
export type TextNode = DefaultTreeAdapterMap['textNode'];
export type ParentNode = DefaultTreeAdapterMap['parentNode'];
export type Node = DefaultTreeAdapterMap['node'];

/** Byte offsets into the original HTML string. */
export interface SourceRange {
  startOffset: number;
  endOffset: number;
}

/**
 * Elements whose text is never evidence: code, styling, embedded documents.
 * `template` is included because its content is not rendered.
 */
const NON_TEXT_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
  'head',
]);

/** Elements that imply a text break, so adjacent blocks do not run together. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl',
  'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/**
 * Parses a full HTML document. Location info is enabled by default so every node
 * carries its byte offsets, which is what lets an answer point back to the exact
 * region of the source it came from. Disable it only for throwaway parsing where
 * offsets are genuinely not needed.
 */
export function parseDocument(html: string, withLocationInfo = true): Document {
  return parse(html, { sourceCodeLocationInfo: withLocationInfo });
}

/** Parses an HTML fragment, e.g. a table served on its own. */
export function parseHtmlFragment(html: string, withLocationInfo = true): DocumentFragment {
  return parseFragment(html, { sourceCodeLocationInfo: withLocationInfo });
}

function pushChildren(stack: Node[], parent: ParentNode): void {
  const children = parent.childNodes;
  // Pushed in reverse so the stack yields document order.
  for (let i = children.length - 1; i >= 0; i -= 1) {
    stack.push(children[i]);
  }
}

/** Depth-first pre-order walk. Iterative, so deep real-world pages cannot blow the stack. */
export function walk(root: Node, visit: (node: Node) => void): void {
  const stack: Node[] = [root];
  let current = stack.pop();
  while (current !== undefined) {
    visit(current);
    if (isParentNode(current)) {
      pushChildren(stack, current);
    }
    current = stack.pop();
  }
}

export function isParentNode(node: Node): node is ParentNode {
  return Array.isArray((node as { childNodes?: unknown }).childNodes);
}

export function isElement(node: Node): node is Element {
  return typeof (node as { tagName?: unknown }).tagName === 'string';
}

export function isTextNode(node: Node): node is TextNode {
  return node.nodeName === '#text';
}

/** Every descendant element with the given tag name, in document order. */
export function findAll(root: Node, tagName: string): Element[] {
  const wanted = tagName.toLowerCase();
  const matches: Element[] = [];
  walk(root, (node) => {
    if (isElement(node) && node.tagName.toLowerCase() === wanted) {
      matches.push(node);
    }
  });
  return matches;
}

/** Attribute lookup, case-insensitive in the attribute name as HTML requires. */
export function getAttr(element: Element, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const attr of element.attrs) {
    if (attr.name.toLowerCase() === wanted) {
      return attr.value;
    }
  }
  return undefined;
}

/** Collapses all whitespace runs to a single space and trims. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Visible text of a node, with `script`/`style` content excluded and block
 * boundaries turned into spaces so words from adjacent elements do not merge.
 *
 * Note this is deliberately generic: it spans the whole subtree it is given,
 * including navigation and footers. Choosing the main content region is
 * extraction's job (`engine/extract/`), not this helper's.
 */
export function textContent(root: Node): string {
  const parts: string[] = [];
  const stack: Node[] = [root];

  let current = stack.pop();
  while (current !== undefined) {
    if (isTextNode(current)) {
      parts.push(current.value);
    } else if (isElement(current)) {
      const tag = current.tagName.toLowerCase();
      if (!NON_TEXT_TAGS.has(tag)) {
        if (BLOCK_TAGS.has(tag)) {
          parts.push(' ');
        }
        pushChildren(stack, current);
      }
    } else if (isParentNode(current)) {
      pushChildren(stack, current);
    }
    current = stack.pop();
  }

  return collapseWhitespace(parts.join(''));
}

/**
 * Byte range of a node in the original HTML, when location info is enabled.
 * Returns `undefined` for synthetic nodes, which have no source to point at.
 */
export function sourceRange(node: Node): SourceRange | undefined {
  const location = node.sourceCodeLocation;
  if (!location) {
    return undefined;
  }
  return { startOffset: location.startOffset, endOffset: location.endOffset };
}
