import { expect, test } from 'bun:test';
import { buildSnippet, queryTokens, segment, toMatchExpr } from './jieba';

test('segment splits Chinese into space-joined tokens', () => {
  const out = segment('帮我调研一下搜索功能的实现方案');
  const tokens = out.split(' ');
  expect(tokens).toContain('搜索');
  expect(tokens).toContain('功能');
  expect(out).not.toContain('搜索功能的'); // genuinely segmented, not one blob
});

test('segment returns empty string for empty input', () => {
  expect(segment('')).toBe('');
});

test('queryTokens dedupes and drops punctuation/whitespace', () => {
  const tokens = queryTokens('搜索, 搜索  功能!');
  expect(new Set(tokens)).toEqual(new Set(['搜索', '功能']));
});

test('queryTokens returns [] for a blank query', () => {
  expect(queryTokens('   ')).toEqual([]);
});

test('toMatchExpr quotes each token and ANDs them', () => {
  expect(toMatchExpr(['搜索', '功能'])).toBe('"搜索" "功能"');
});

test('toMatchExpr escapes embedded quotes and returns null when empty', () => {
  expect(toMatchExpr(['a"b'])).toBe('"a""b"');
  expect(toMatchExpr([])).toBeNull();
});

test('buildSnippet highlights the matched token on the original text', () => {
  const raw = '帮我调研一下搜索功能的实现方案';
  const snip = buildSnippet(raw, ['搜索功能']);
  expect(snip.text).toContain('搜索功能');
  expect(snip.highlights.length).toBe(1);
  const [s, e] = snip.highlights[0];
  expect(snip.text.slice(s, e)).toBe('搜索功能');
});

test('buildSnippet returns sorted, non-overlapping ranges for multiple tokens', () => {
  const raw = '帮我调研一下搜索功能的实现方案';
  const snip = buildSnippet(raw, ['方案', '调研']);
  expect(snip.highlights.length).toBe(2);
  expect(snip.highlights[0][0]).toBeLessThan(snip.highlights[1][0]);
  for (const [s, e] of snip.highlights) {
    expect(['调研', '方案']).toContain(snip.text.slice(s, e));
  }
});

test('buildSnippet matches case-insensitively', () => {
  const snip = buildSnippet('Hello World', ['hello']);
  const [s, e] = snip.highlights[0];
  expect(snip.text.slice(s, e)).toBe('Hello');
});

test('buildSnippet with no match returns a leading window and no highlights', () => {
  const snip = buildSnippet('abcdef', ['xyz']);
  expect(snip.highlights).toEqual([]);
  expect(snip.text).toBe('abcdef');
  expect(snip.truncatedStart).toBe(false);
});

test('buildSnippet clips a long prefix and flags truncation', () => {
  const raw = `${'前'.repeat(100)}搜索${'后'.repeat(100)}`;
  const snip = buildSnippet(raw, ['搜索']);
  expect(snip.truncatedStart).toBe(true);
  expect(snip.truncatedEnd).toBe(true);
  const [s, e] = snip.highlights[0];
  expect(snip.text.slice(s, e)).toBe('搜索');
});
