import { afterEach, expect, test } from 'bun:test';
import { webFetchTool } from './web-fetch';

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant to these tests
const opts = {} as any;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(res: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  body?: string;
}): void {
  globalThis.fetch = (async () =>
    ({
      ok: res.ok ?? true,
      status: res.status ?? 200,
      statusText: res.statusText ?? 'OK',
      headers: new Headers({ 'content-type': res.contentType ?? 'text/html' }),
      text: async () => res.body ?? '',
    }) as Response) as unknown as typeof fetch;
}

const para = (n: number) =>
  `<p>This is paragraph number ${n} of the main article body, written long enough that Readability treats it as real content rather than boilerplate noise it should discard.</p>`;
const ARTICLE_HTML = `<html><head><title>Quantum Notes</title></head><body>
  <nav>HOME · ABOUT · CONTACT · subscribe to our newsletter today</nav>
  <article><h1>Quantum Notes</h1>${[1, 2, 3, 4].map(para).join('')}</article>
  <footer>Copyright 2026 · all rights reserved · privacy policy</footer>
</body></html>`;

test('extracts the main article as markdown, dropping nav and footer', async () => {
  stubFetch({ body: ARTICLE_HTML });
  const out = (await webFetchTool().execute?.(
    { description: 'x', url: 'https://example.com/a' },
    opts,
  )) as string;
  expect(out).toContain('# Quantum Notes');
  expect(out).toContain('paragraph number 1');
  expect(out).not.toContain('subscribe to our newsletter');
  expect(out).not.toContain('all rights reserved');
  // Page content is attacker-controllable, so it comes back fenced as untrusted.
  expect(out).toContain('<untrusted-content>');
});

test('fences non-HTML text content as untrusted', async () => {
  stubFetch({ contentType: 'text/plain', body: 'plain body text' });
  const out = (await webFetchTool().execute?.(
    { description: 'x', url: 'https://example.com/raw.txt' },
    opts,
  )) as string;
  expect(out).toContain('plain body text');
  expect(out).toContain('<untrusted-content>');
});

test('rejects binary content types', async () => {
  stubFetch({ contentType: 'application/pdf', body: '%PDF-1.7' });
  const out = (await webFetchTool().execute?.(
    { description: 'x', url: 'https://example.com/doc.pdf' },
    opts,
  )) as string;
  expect(out).toContain('cannot be read as text');
});

test('surfaces HTTP errors as a model-readable string', async () => {
  stubFetch({ ok: false, status: 404, statusText: 'Not Found' });
  const out = (await webFetchTool().execute?.(
    { description: 'x', url: 'https://example.com/missing' },
    opts,
  )) as string;
  expect(out).toBe('Error: HTTP 404 Not Found for https://example.com/missing');
});

test('rejects non-http(s) URLs without fetching', async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return {} as Response;
  }) as unknown as typeof fetch;
  const out = (await webFetchTool().execute?.(
    { description: 'x', url: 'file:///etc/passwd' },
    opts,
  )) as string;
  expect(out).toContain('only http(s) URLs are supported');
  expect(fetched).toBe(false);
});
