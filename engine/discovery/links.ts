import { collapseWhitespace, findAll, getAttr, textContent, type Document } from '../dom/parseHtml';
import { contentTokens } from '../util/text';
import { resolveHttpUrl, safeUrl } from '../util/url';

/**
 * Bounded link discovery — the "navigate the site" half of retrieval.
 *
 * Only links from a page that was already read are offered, and they are ranked by
 * anchor text against the question. The pipeline applies the page budget and the
 * depth cap; this module's single job is to propose the *most promising* links
 * first, because with a budget of five pages the order matters more than the list.
 */

export interface DiscoveredLink {
  url: string;
  score: number;
}

/** Non-navigational hrefs. `resolveHttpUrl` would reject most of these anyway. */
const NON_NAVIGATIONAL = /^(#|mailto:|tel:|javascript:|data:|blob:)/i;

export function extractLinks(doc: Document, baseUrl: string, keywords: readonly string[]): DiscoveredLink[] {
  const base = safeUrl(baseUrl);
  if (!base) {
    return [];
  }

  const seen = new Set<string>();
  const links: DiscoveredLink[] = [];

  for (const anchor of findAll(doc, 'a')) {
    const href = getAttr(anchor, 'href')?.trim();
    if (!href || NON_NAVIGATIONAL.test(href)) {
      continue;
    }

    const url = resolveHttpUrl(href, base);
    if (!url || url === baseUrl || seen.has(url)) {
      continue;
    }
    seen.add(url);

    const anchorTokens = new Set(contentTokens(collapseWhitespace(textContent(anchor))));
    let score = 0;
    for (const keyword of keywords) {
      if (anchorTokens.has(keyword)) {
        score += 2;
      }
    }

    const resolved = safeUrl(url);
    if (resolved && resolved.origin === base.origin) {
      // Staying on the same site is the sane default: it keeps a run from wandering
      // off to an unrelated domain on a single incidental link.
      score += 1.5;
    }

    links.push({ url, score });
  }

  return links.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}
