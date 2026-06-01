import { expect, test } from 'bun:test';
import type { ModelMessage, UIMessage } from 'ai';
import {
  countTokens,
  countTokensModel,
  estimateTokens,
  tokensOfModelMessage,
  tokensOfUIMessage,
} from './tokens';

const ui = (
  role: UIMessage['role'],
  parts: unknown[],
  metadata?: Record<string, unknown>,
): UIMessage => ({ id: 'x', role, parts, metadata }) as unknown as UIMessage;

const text = (t: string) => ({ type: 'text', text: t });

test('estimateTokens is chars/4 rounded up', () => {
  expect(estimateTokens('')).toBe(0);
  expect(estimateTokens('abcd')).toBe(1);
  expect(estimateTokens('abcde')).toBe(2);
});

test('tokensOfUIMessage sums text, tool input and output', () => {
  const msg = ui('assistant', [
    text('aaaa'),
    { type: 'tool-bash', input: { cmd: 'ls' }, output: { out: 'ok' } },
  ]);
  const expected = estimateTokens(
    'aaaa' + JSON.stringify({ cmd: 'ls' }) + JSON.stringify({ out: 'ok' }),
  );
  expect(tokensOfUIMessage(msg)).toBe(expected);
});

test('tokensOfModelMessage handles string and array content', () => {
  expect(tokensOfModelMessage({ role: 'user', content: 'aaaaaaaa' } as ModelMessage)).toBe(2);
  expect(
    tokensOfModelMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'aaaa' }],
    } as ModelMessage),
  ).toBe(1);
});

test('countTokens falls back to full estimate when nothing is counted', () => {
  const msgs = [ui('user', [text('aaaaaaaa')])]; // 8 chars -> 2
  expect(countTokens(msgs)).toBe(2);
});

test('countTokens anchors on the latest contextTokens and estimates the tail', () => {
  const msgs = [
    ui('user', [text('ignored prefix content')]),
    ui('assistant', [text('also ignored')], { contextTokens: 1000 }),
    ui('user', [text('aaaaaaaa')]), // 8 chars -> 2
  ];
  expect(countTokens(msgs)).toBe(1002);
});

test('countTokens uses the most recent anchor, not an earlier one', () => {
  const msgs = [
    ui('assistant', [text('x')], { contextTokens: 500 }),
    ui('assistant', [text('y')], { contextTokens: 1000 }),
    ui('user', [text('aaaaaaaa')]), // -> 2
  ];
  expect(countTokens(msgs)).toBe(1002);
});

test('countTokensModel is a pure estimate over content', () => {
  const msgs: ModelMessage[] = [
    { role: 'user', content: 'aaaaaaaa' }, // 2
    { role: 'assistant', content: [{ type: 'text', text: 'aaaa' }] }, // 1
  ];
  expect(countTokensModel(msgs)).toBe(3);
});
