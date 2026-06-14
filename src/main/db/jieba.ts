import { cut_for_search } from 'jieba-wasm';

/**
 * Chinese-aware text segmentation for full-text search, backed by jieba (via
 * WASM, so no native binary / ABI coupling). Search mode over-segments long
 * words into their sub-words, which raises recall — the right trade-off for a
 * "find that chat" search rather than linguistically-correct tokenization.
 *
 * `segment` feeds the FTS index (registered as the `jieba_cut` SQL function so
 * triggers index every write path); `queryTokens` + `toMatchExpr` build the
 * query; `buildSnippet` produces the highlighted preview against the original
 * text — FTS5's own snippet() would operate on the space-mangled indexed text,
 * so we highlight on `text_raw` ourselves.
 */

/** A token is searchable only if it carries a letter or digit — drop the
 *  punctuation/whitespace tokens jieba emits, which unicode61 wouldn't index. */
function isSearchable(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

/** Segment text into space-joined tokens for the FTS index. */
export function segment(text: string): string {
  if (!text) return '';
  return cut_for_search(text, true).join(' ');
}

/** Distinct searchable tokens of a query, used for both matching and highlight. */
export function queryTokens(query: string): string[] {
  if (!query.trim()) return [];
  const seen = new Set<string>();
  for (const token of cut_for_search(query, true)) {
    if (isSearchable(token)) seen.add(token);
  }
  return [...seen];
}

/**
 * An FTS5 MATCH expression: each token quoted (so FTS5 treats it as a literal,
 * never as query syntax) and ANDed — a row must contain every token. Returns
 * null when the query has no searchable tokens.
 */
export function toMatchExpr(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
}

export type Snippet = {
  /** A window of the original text around the first match. */
  text: string;
  /** [start, end) ranges within `text` to wrap as highlights, sorted, merged. */
  highlights: [number, number][];
  /** Whether `text` was clipped at the start (render a leading ellipsis). */
  truncatedStart: boolean;
  /** Whether `text` was clipped at the end (render a trailing ellipsis). */
  truncatedEnd: boolean;
};

/**
 * Build a highlighted preview of `raw` around its first match of any query
 * token. Tokens are matched case-insensitively via indexOf — jieba tokens are
 * contiguous substrings of the source, so no offset mapping is needed.
 */
export function buildSnippet(raw: string, tokens: string[], pad = 24): Snippet {
  const hay = raw.toLowerCase();

  const all: [number, number][] = [];
  let firstMatch = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const needle = token.toLowerCase();
    let from = 0;
    while (true) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      all.push([idx, idx + token.length]);
      firstMatch = Math.min(firstMatch, idx);
      from = idx + token.length;
    }
  }

  if (firstMatch === Number.POSITIVE_INFINITY) {
    const text = raw.slice(0, pad * 3);
    return { text, highlights: [], truncatedStart: false, truncatedEnd: raw.length > text.length };
  }

  const start = Math.max(0, firstMatch - pad);
  const end = Math.min(raw.length, firstMatch + pad * 3);
  const text = raw.slice(start, end);

  const highlights = mergeRanges(
    all
      .filter(([s, e]) => e > start && s < end)
      .map(([s, e]): [number, number] => [
        Math.max(0, s - start),
        Math.min(text.length, e - start),
      ]),
  );

  return { text, highlights, truncatedStart: start > 0, truncatedEnd: end < raw.length };
}

/** Sort by start, then coalesce overlapping/adjacent ranges. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const [s, e] = sorted[i];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}
