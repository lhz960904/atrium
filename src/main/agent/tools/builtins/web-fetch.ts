import { Readability } from '@mozilla/readability';
import { tool } from 'ai';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { z } from 'zod';
import { headTruncate } from '../output';

const FETCH_MAX = 50_000;
const FETCH_TIMEOUT_MS = 20_000;
// Cap the raw payload before parsing — Readability + turndown on a multi-MB
// page is slow and pointless; the model never needs that much.
const MAX_HTML_BYTES = 5 * 1024 * 1024;

// Present as a real browser. Many servers trim or gate the response (or return
// a JS-only shell) for non-browser User-Agents; a Chrome UA gets the full page.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let turndown: TurndownService | undefined;
function toMarkdown(html: string): string {
  turndown ??= new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  return turndown.turndown(html);
}

export const webFetchTool = () =>
  tool({
    description:
      'Fetch a web page and return its main readable content as Markdown. Use this to read an article, documentation, or any URL the user mentions or that a web search surfaced. Navigation, ads, and boilerplate are stripped out.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are fetching this page, in short words. ALWAYS PROVIDE THIS FIRST.'),
      url: z.url().describe('The absolute http(s) URL to fetch.'),
    }),
    execute: async ({ url }) => {
      try {
        return await fetchAsMarkdown(url);
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          return `Error: timed out fetching ${url} after ${FETCH_TIMEOUT_MS / 1000}s`;
        }
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

async function fetchAsMarkdown(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Error: only http(s) URLs are supported, got ${parsed.protocol}`;
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return `Error: HTTP ${res.status} ${res.statusText} for ${url}`;

  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();

  // Already text-ish (markdown/plain/json/csv) — hand it back as-is; running it
  // through an HTML extractor would only mangle it.
  if (!contentType.includes('html')) {
    if (isBinary(contentType)) {
      return `Error: ${url} is ${contentType.split(';')[0] || 'binary'} content, which cannot be read as text.`;
    }
    return headTruncate(body.trim(), FETCH_MAX, 'content was truncated');
  }

  const html = body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;
  const { document } = parseHTML(html);
  // Readability mutates the document, so parse once on the live doc. It returns
  // null on pages it can't make sense of (no article structure) — fall back to
  // turndown-ing the whole body so the model still gets something.
  const article = new Readability(document).parse();
  const contentHtml = article?.content ?? document.body?.innerHTML ?? html;
  const markdown = toMarkdown(contentHtml).trim();
  if (markdown === '') return `(no readable content extracted from ${url})`;

  const title = article?.title?.trim();
  const heading = title ? `# ${title}\n\n` : '';
  return headTruncate(`${heading}${markdown}`, FETCH_MAX, 'content was truncated');
}

function isBinary(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('application/octet-stream') ||
    contentType.includes('pdf') ||
    contentType.includes('zip')
  );
}
