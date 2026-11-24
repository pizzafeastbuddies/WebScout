import { MAX_CANDIDATES_PER_SOURCE } from '../contract/internal';
import { collapseWhitespace, findAll, getAttr, isTextNode, type Document, type Element, type ParentNode } from '../dom/parseHtml';
import type { Candidate } from './candidate';

/**
 * Structured-data extraction: JSON-LD blocks and `<meta>` tags.
 *
 * These are the highest-precision candidates on a page. A value published in a
 * `Product` JSON-LD block is machine-readable and unambiguous, so it should
 * outrank a sentence that merely mentions the same figure.
 *
 * A note on the raw-text reader below: the engine's `textContent` helper
 * deliberately skips `<script>` content, because a script's body is code rather
 * than something a reader sees. JSON-LD *is* a `<script>`, so its text has to be
 * read directly off the node.
 */

const MAX_JSON_DEPTH = 6;
const MAX_JSON_LEAVES = 60;

/** Concatenated text-node children — the only way to read `<script>` content. */
function rawText(node: ParentNode): string {
  let value = '';
  for (const child of node.childNodes) {
    if (isTextNode(child)) {
      value += child.value;
    }
  }
  return value.trim();
}

function isLdJson(script: Element): boolean {
  const type = (getAttr(script, 'type') ?? '').toLowerCase();
  return type.includes('ld+json');
}

/**
 * The structural labels for a JSON-LD leaf: the property names alongside it plus
 * any sibling string values. "version" alone is a weak hint; the fact that the
 * same object also names the product is what lets the ranking stage tell which
 * question this value answers.
 */
function contextFor(container: Record<string, unknown>): string {
  const labels: string[] = Object.keys(container);
  const siblings: string[] = [];
  for (const value of Object.values(container)) {
    if (typeof value === 'string' && value.length <= 120) {
      siblings.push(value);
    }
  }
  return collapseWhitespace([...labels, ...siblings].join(' '));
}

function flattenJsonLd(value: unknown, pointer: string, context: string, out: Candidate[], sourceUrl: string, depth: number): void {
  if (out.length >= MAX_JSON_LEAVES || depth > MAX_JSON_DEPTH) {
    return;
  }

  if (typeof value === 'string') {
    const text = collapseWhitespace(value);
    if (text) {
      out.push({ text, sourceUrl, locator: { kind: 'structured', jsonPointer: pointer }, context });
    }
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    out.push({ text, sourceUrl, locator: { kind: 'structured', jsonPointer: pointer }, context });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJsonLd(item, `${pointer}/${index}`, context, out, sourceUrl, depth + 1));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    const container = value as Record<string, unknown>;
    const childContext = collapseWhitespace(`${context} ${contextFor(container)}`);
    for (const [key, child] of Object.entries(container)) {
      flattenJsonLd(child, `${pointer}/${key}`, childContext, out, sourceUrl, depth + 1);
    }
  }
}

function metaName(meta: Element): string | undefined {
  return getAttr(meta, 'name') ?? getAttr(meta, 'property') ?? getAttr(meta, 'itemprop');
}

export function extractStructuredCandidates(doc: Document, sourceUrl: string): Candidate[] {
  const candidates: Candidate[] = [];

  for (const script of findAll(doc, 'script')) {
    if (!isLdJson(script)) {
      continue;
    }
    const payload = rawText(script);
    if (!payload) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Malformed JSON-LD is common in the wild. It is simply not evidence.
      continue;
    }
    flattenJsonLd(parsed, '', '', candidates, sourceUrl, 0);
  }

  for (const meta of findAll(doc, 'meta')) {
    const name = metaName(meta);
    const content = getAttr(meta, 'content');
    if (!name || !content) {
      continue;
    }
    const text = collapseWhitespace(content);
    if (!text) {
      continue;
    }
    candidates.push({
      text,
      sourceUrl,
      locator: { kind: 'structured', jsonPointer: `meta:${name}` },
      context: name,
    });
  }

  return candidates.slice(0, MAX_CANDIDATES_PER_SOURCE);
}
