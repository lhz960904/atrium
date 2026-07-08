import { expect, test } from 'bun:test';
import {
  formatResults,
  parseBingResults,
  parseBraveResults,
  parseDdgResults,
  type RawResult,
} from './engines';

const redirect = (realUrl: string) =>
  `https://duckduckgo.com/l/?uddg=${encodeURIComponent(realUrl)}&rut=abc123`;

test('decodes the real destination URL out of the DDG redirect wrapper', () => {
  const raw: RawResult[] = [
    {
      title: 'AI SDK Core: streamText',
      href: redirect('https://ai-sdk.dev/docs'),
      snippet: 'Streams text.',
    },
  ];
  expect(parseDdgResults(raw)).toEqual([
    { title: 'AI SDK Core: streamText', url: 'https://ai-sdk.dev/docs', snippet: 'Streams text.' },
  ]);
});

test('drops sponsored results that redirect back to a duckduckgo.com tracker', () => {
  const raw: RawResult[] = [
    {
      title: 'Ad',
      href: redirect('https://duckduckgo.com/y.js?ad_provider=bingv7aa'),
      snippet: 'buy now',
    },
    { title: 'Real', href: redirect('https://vercel.com/docs'), snippet: 'real result' },
  ];
  const out = parseDdgResults(raw);
  expect(out).toHaveLength(1);
  expect(out[0].url).toBe('https://vercel.com/docs');
});

test('drops related-search suggestion links that point back to a new query', () => {
  // These render in the same `.result__a` block but lead to `?q=<new query>`,
  // not a destination — they must never reach the model as results.
  const raw: RawResult[] = [
    { title: '美光半导体', href: 'https://duckduckgo.com/?q=%E7%BE%8E%E5%85%89&t=h_', snippet: '' },
    { title: '美光官网', href: 'https://duckduckgo.com/?q=%E5%AE%98%E7%BD%91&t=h_', snippet: '' },
  ];
  expect(parseDdgResults(raw)).toEqual([]);
});

test('keeps a bare href that is not wrapped in a redirect', () => {
  const raw: RawResult[] = [{ title: 'Plain', href: 'https://example.com/page', snippet: '' }];
  expect(parseDdgResults(raw)[0].url).toBe('https://example.com/page');
});

test('skips entries missing a title or an unparseable href', () => {
  const raw: RawResult[] = [
    { title: '', href: redirect('https://x.com'), snippet: '' },
    { title: 'No href', href: '', snippet: '' },
    { title: 'Bad', href: 'not a url', snippet: '' },
  ];
  expect(parseDdgResults(raw)).toEqual([]);
});

test('keeps direct Brave hrefs and drops links staying on brave.com', () => {
  const raw: RawResult[] = [
    { title: 'Harness: AI for DevOps', href: 'https://www.harness.io/', snippet: 'CI/CD' },
    { title: 'Brave feature', href: 'https://search.brave.com/help', snippet: '' },
    { title: 'Bad', href: 'not a url', snippet: '' },
  ];
  expect(parseBraveResults(raw)).toEqual([
    { title: 'Harness: AI for DevOps', url: 'https://www.harness.io/', snippet: 'CI/CD' },
  ]);
});

test('decodes the destination out of the Bing /ck/a redirect wrapper', () => {
  const dest = 'https://harness-engineering.ai/blog/agent-harness-complete-guide/';
  const u = `a1${Buffer.from(dest, 'utf8').toString('base64url')}`;
  const raw: RawResult[] = [
    {
      title: 'The Complete Guide to Agent Harness',
      href: `https://www.bing.com/ck/a?!&&p=abc&u=${u}&ntb=1`,
      snippet: 'An agent harness is…',
    },
  ];
  expect(parseBingResults(raw)).toEqual([
    { title: 'The Complete Guide to Agent Harness', url: dest, snippet: 'An agent harness is…' },
  ]);
});

test('drops Bing links whose destination stays on bing.com', () => {
  const u = `a1${Buffer.from('https://www.bing.com/images', 'utf8').toString('base64url')}`;
  const raw: RawResult[] = [
    { title: 'Images', href: `https://www.bing.com/ck/a?u=${u}`, snippet: '' },
    { title: 'Plain', href: 'https://example.com/page', snippet: '' },
  ];
  expect(parseBingResults(raw)).toEqual([
    { title: 'Plain', url: 'https://example.com/page', snippet: '' },
  ]);
});

test('formats results as a numbered markdown list', () => {
  const out = formatResults('q', [
    { title: 'First', url: 'https://a.com', snippet: 'snip a' },
    { title: 'Second', url: 'https://b.com', snippet: '' },
  ]);
  expect(out).toContain('Search results for "q"');
  expect(out).toContain('1. First\n   https://a.com\n   snip a');
  expect(out).toContain('2. Second\n   https://b.com');
});

test('reports no results plainly', () => {
  expect(formatResults('nothing', [])).toBe('No results found for "nothing".');
});
