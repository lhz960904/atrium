import { expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { pickRecentWindowModel } from './window';

test('pickRecentWindowModel never starts the window on an orphan tool result', () => {
  const msgs: ModelMessage[] = [
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: '1', toolName: 'x', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '1',
          toolName: 'x',
          output: { type: 'text', value: '' },
        },
      ],
    },
    { role: 'assistant', content: 'aaaa' },
  ];
  // budget would cut at the tool message; it must back up onto its assistant
  const kept = pickRecentWindowModel(msgs, { keepRecentTokens: 2, minKeepMessages: 1 });
  expect(kept[0].role).toBe('assistant');
  expect(kept).toHaveLength(3);
});
