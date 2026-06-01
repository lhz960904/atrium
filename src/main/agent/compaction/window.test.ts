import { expect, test } from 'bun:test';
import type { ModelMessage, UIMessage } from 'ai';
import { findLatestCheckpoint, pickRecentWindow, pickRecentWindowModel } from './window';

const ui = (text: string, metadata?: Record<string, unknown>): UIMessage =>
  ({ id: text, role: 'user', parts: [{ type: 'text', text }], metadata }) as unknown as UIMessage;

test('findLatestCheckpoint returns undefined when there is none', () => {
  expect(findLatestCheckpoint([ui('a'), ui('b')])).toBeUndefined();
});

test('findLatestCheckpoint returns the last compaction marker', () => {
  const msgs = [ui('a', { kind: 'compaction' }), ui('b'), ui('c', { kind: 'compaction' }), ui('d')];
  expect(findLatestCheckpoint(msgs)?.index).toBe(2);
});

test('pickRecentWindow returns all when at or under minKeep', () => {
  const msgs = [ui('a'), ui('b'), ui('c')];
  expect(pickRecentWindow(msgs, { keepRecentTokens: 100, minKeepMessages: 4 })).toHaveLength(3);
});

test('pickRecentWindow keeps the tail up to the token budget', () => {
  // each 'aaaaaaaa' is 8 chars -> 2 tokens
  const msgs = [ui('aaaaaaaa'), ui('aaaaaaaa'), ui('aaaaaaaa'), ui('aaaaaaaa')];
  const kept = pickRecentWindow(msgs, { keepRecentTokens: 4, minKeepMessages: 1 });
  expect(kept).toHaveLength(2);
});

test('pickRecentWindow respects minKeep above the budget', () => {
  const msgs = [ui('aaaaaaaa'), ui('aaaaaaaa'), ui('aaaaaaaa'), ui('aaaaaaaa')];
  const kept = pickRecentWindow(msgs, { keepRecentTokens: 1, minKeepMessages: 3 });
  expect(kept).toHaveLength(3);
});

test('pickRecentWindow walks the cut back to a user turn', () => {
  const m = (id: string, role: UIMessage['role']): UIMessage =>
    ({ id, role, parts: [{ type: 'text', text: 'aaaaaaaa' }] }) as unknown as UIMessage;
  const msgs = [m('u1', 'user'), m('a1', 'assistant'), m('u2', 'user'), m('a2', 'assistant')];
  // budget alone would cut at a2 (assistant); it must back up to the user turn
  const kept = pickRecentWindow(msgs, { keepRecentTokens: 1, minKeepMessages: 1 });
  expect(kept[0].id).toBe('u2');
});

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
