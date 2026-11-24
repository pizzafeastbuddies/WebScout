/**
 * URL parsing, kept in one place so the fetchers and the link discoverer agree on
 * what counts as "a page we are willing to touch".
 *
 * `URL` is a standard web API and therefore available in the browser, in Deno and
 * in Node — the same reason the engine uses `fetch` and `TextEncoder` rather than
 * anything runtime-specific.
 */

/** Parses a URL, returning `undefined` instead of throwing on junk input. */
export function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** True for `http:`/`https:` only — deliberately excludes `mailto:`, `data:`, `javascript:`. */
export function isHttpUrl(value: string): boolean {
  const parsed = safeUrl(value);
  return parsed !== undefined && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

/**
 * Resolves a possibly-relative href against a base URL and strips the fragment.
 *
 * Returning `undefined` for non-HTTP results is what keeps `#section`, `mailto:`
 * and `javascript:` links out of the crawl queue without a separate allowlist.
 */
export function resolveHttpUrl(href: string, base: string | URL): string | undefined {
  try {
    const resolved = new URL(href, typeof base === 'string' ? base : base.toString());
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return undefined;
    }
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return undefined;
  }
}
