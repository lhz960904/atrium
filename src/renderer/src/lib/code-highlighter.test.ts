import { expect, test } from 'bun:test';
import { ShikiStreamTokenizer } from '@shikijs/stream';
import { DARK_THEME, highlighter } from './code-highlighter';

const sig = (tokens: { content: string; color?: string }[]) =>
  tokens.map((t) => `${t.content} ${t.color ?? ''}`);
const reconstruct = (tokens: { content: string }[]) => tokens.map((t) => t.content).join('');

const CODE_A = 'function greet(name: string) {\n  /* c\n  */ return name;\n}';
// biome-ignore lint/suspicious/noTemplateCurlyInString: sample code containing a template literal
const CODE_B = 'const xs = [1, 2, 3].map((n) => `${n}`);';

// What the component renders: the accumulated stable list plus the still-live
// unstable tail (recalls are already reflected in these two arrays).
const rendered = (tk: ShikiStreamTokenizer) => [...tk.tokensStable, ...tk.tokensUnstable];

async function streamAll(code: string, chunk = 4): Promise<ShikiStreamTokenizer> {
  const tk = new ShikiStreamTokenizer({ highlighter, lang: 'typescript', theme: DARK_THEME });
  for (let i = 0; i < code.length; i += chunk) await tk.enqueue(code.slice(i, i + chunk));
  return tk;
}

test('streamed tokens reconstruct the original source exactly (newlines and all)', async () => {
  expect(reconstruct(rendered(await streamAll(CODE_A)))).toBe(CODE_A);
});

test('a tokenizer is unaffected by other blocks tokenizing on the shared highlighter', async () => {
  const solo = sig(rendered(await streamAll(CODE_A)));

  // Interleave CODE_A with CODE_B chunk-by-chunk across two tokenizers that
  // share the one highlighter — the exact pattern that made a hand-rolled
  // grammar-state cache non-deterministic.
  const a = new ShikiStreamTokenizer({ highlighter, lang: 'typescript', theme: DARK_THEME });
  const b = new ShikiStreamTokenizer({ highlighter, lang: 'typescript', theme: DARK_THEME });
  for (let i = 0; i < Math.max(CODE_A.length, CODE_B.length); i += 4) {
    if (i < CODE_A.length) await a.enqueue(CODE_A.slice(i, i + 4));
    if (i < CODE_B.length) await b.enqueue(CODE_B.slice(i, i + 4));
  }
  expect(sig(rendered(a))).toEqual(solo);
});

test('chunk boundaries do not change the result (char-by-char == whole)', async () => {
  const perChar = sig(rendered(await streamAll(CODE_A, 1)));
  const whole = sig(rendered(await streamAll(CODE_A, CODE_A.length)));
  expect(perChar).toEqual(whole);
});
