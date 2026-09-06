import { expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { countTokensModel, estimateTokens, tokensOfModelMessage } from './tokens';

test('estimateTokens is chars/4 rounded up', () => {
  expect(estimateTokens('')).toBe(0);
  expect(estimateTokens('abcd')).toBe(1);
  expect(estimateTokens('abcde')).toBe(2);
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

test('countTokensModel charges content-type image parts flat', () => {
  const msgs = [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '1',
          toolName: 'shot',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'aaaa' },
              { type: 'image-data', data: 'A'.repeat(100_000), mediaType: 'image/png' },
            ],
          },
        },
      ],
    },
  ] as unknown as ModelMessage[];
  expect(countTokensModel(msgs)).toBe(1 + 1600);
});

test('countTokensModel is a pure estimate over content', () => {
  const msgs: ModelMessage[] = [
    { role: 'user', content: 'aaaaaaaa' }, // 2
    { role: 'assistant', content: [{ type: 'text', text: 'aaaa' }] }, // 1
  ];
  expect(countTokensModel(msgs)).toBe(3);
});
