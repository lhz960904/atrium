/**
 * Search-engine adapters and the pure result-shaping logic, kept free of any
 * Electron import so it stays unit-testable. The BrowserWindow that actually
 * loads the page and runs `scrapeScript` lives in ./run-search.
 *
 * Why scrape a real browser instead of an API: keyless search backends (DDG)
 * now gate plain HTTP behind a JS anomaly challenge, so only a real Chromium
 * passing the challenge gets results. Adding an engine = one more SearchEngine.
 */

/** What the in-page scrape returns, before URL decoding / ad filtering. */
export type RawResult = { title: string; href: string; snippet: string };
/** A cleaned result handed to the model. */
export type SearchResult = { title: string; url: string; snippet: string };

export type SearchEngine = {
  name: string;
  buildUrl: (query: string) => string;
  /** Polled in-page (count expression) to know results have rendered. */
  readyExpr: string;
  /** Truthy in-page expression when the engine shows a bot challenge instead of results. */
  challengeExpr?: string;
  /** Truthy in-page expression when the engine rendered a genuine no-results state. */
  emptyExpr?: string;
  /** In-page JS (IIFE) returning RawResult[]. */
  scrapeScript: string;
  /** Decode/clean the raw scrape into final results. */
  parse: (raw: RawResult[]) => SearchResult[];
};

// DDG reuses `.result__a` for the "related searches" block too — those point
// at `?q=<new-query>` (a fresh search), not a destination, and render before
// the organic results. Organic hits are the only ones wrapped in a
// `/l/?uddg=` redirect, so require `uddg` in the href to skip suggestions.
const DDG_SCRAPE = `(() => {
  const out = [];
  for (const a of document.querySelectorAll('a.result__a')) {
    const href = a.href || '';
    if (!href.includes('uddg')) continue;
    const result = a.closest('.result');
    out.push({
      title: (a.textContent || '').trim(),
      href,
      snippet: (result && result.querySelector('.result__snippet') ? result.querySelector('.result__snippet').textContent : '').trim(),
    });
  }
  return out;
})()`;

/**
 * DDG wraps every hit in a redirect link `duckduckgo.com/l/?uddg=<real-url>`;
 * the real destination is the (already-decoded) `uddg` param. Sponsored hits
 * decode to a `duckduckgo.com/y.js` tracker — we drop anything still pointing
 * back at duckduckgo.com so the model only sees real external pages.
 */
export function parseDdgResults(raw: RawResult[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of raw) {
    if (!r.title || !r.href) continue;
    let url: string;
    try {
      const href = new URL(r.href, 'https://duckduckgo.com');
      url = href.searchParams.get('uddg') ?? href.toString();
    } catch {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) continue;
    out.push({ title: r.title, url, snippet: r.snippet });
  }
  return out;
}

export const DDG: SearchEngine = {
  name: 'duckduckgo',
  buildUrl: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  readyExpr: 'document.querySelectorAll(\'a.result__a[href*="uddg"]\').length',
  challengeExpr: '!!document.querySelector(\'[class*="anomaly-modal"], #challenge-form\')',
  emptyExpr: "!!document.querySelector('.no-results')",
  scrapeScript: DDG_SCRAPE,
  parse: parseDdgResults,
};

const BRAVE_SCRAPE = `(() => {
  const out = [];
  for (const s of document.querySelectorAll('.snippet[data-type="web"]')) {
    const a = s.querySelector('a[href^="http"]');
    const title = s.querySelector('.title');
    if (!a || !title) continue;
    const desc = s.querySelector('.content, p');
    out.push({
      title: (title.textContent || '').trim(),
      href: a.href,
      snippet: (desc ? desc.textContent : '').trim(),
    });
  }
  return out;
})()`;

/** Brave links point straight at the destination; drop anything staying on brave.com. */
export function parseBraveResults(raw: RawResult[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of raw) {
    if (!r.title || !r.href) continue;
    let host: string;
    try {
      host = new URL(r.href).hostname;
    } catch {
      continue;
    }
    if (host === 'brave.com' || host.endsWith('.brave.com')) continue;
    out.push({ title: r.title, url: r.href, snippet: r.snippet });
  }
  return out;
}

export const BRAVE: SearchEngine = {
  name: 'brave',
  buildUrl: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
  readyExpr: 'document.querySelectorAll(\'.snippet[data-type="web"]\').length',
  scrapeScript: BRAVE_SCRAPE,
  parse: parseBraveResults,
};

const BING_SCRAPE = `(() => {
  const out = [];
  for (const li of document.querySelectorAll('li.b_algo')) {
    const a = li.querySelector('h2 a');
    if (!a) continue;
    const desc = li.querySelector('.b_caption p, p');
    out.push({
      title: (a.textContent || '').trim(),
      href: a.href,
      snippet: (desc ? desc.textContent : '').trim(),
    });
  }
  return out;
})()`;

/**
 * Bing wraps every hit in a `bing.com/ck/a` redirect; the destination is the
 * base64url-encoded `u` param, prefixed with "a1". Unwrap it and drop anything
 * still pointing at bing.com.
 */
export function parseBingResults(raw: RawResult[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of raw) {
    if (!r.title || !r.href) continue;
    let url = r.href;
    try {
      const href = new URL(r.href);
      const u = href.searchParams.get('u');
      if (u?.startsWith('a1')) url = Buffer.from(u.slice(2), 'base64url').toString('utf8');
      const host = new URL(url).hostname;
      if (host === 'bing.com' || host.endsWith('.bing.com')) continue;
    } catch {
      continue;
    }
    out.push({ title: r.title, url, snippet: r.snippet });
  }
  return out;
}

export const BING: SearchEngine = {
  name: 'bing',
  buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  readyExpr: "document.querySelectorAll('li.b_algo').length",
  scrapeScript: BING_SCRAPE,
  parse: parseBingResults,
};

/** Tried in order; a blocked or timed-out engine falls through to the next. */
export const ENGINES: SearchEngine[] = [DDG, BRAVE, BING];

/** Render results as a compact numbered Markdown list for the model. */
export function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No results found for "${query}".`;
  const body = results
    .map((r, i) => {
      const snippet = r.snippet ? `\n   ${r.snippet}` : '';
      return `${i + 1}. ${r.title}\n   ${r.url}${snippet}`;
    })
    .join('\n\n');
  return `Search results for "${query}":\n\n${body}`;
}
