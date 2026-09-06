import { expect, test } from 'bun:test';
import type { AssistantMessage, Message, Usage } from '@shared/protocol';
import { countTokens, estimateContextTokens, estimateTokens, tokensOfMessage } from './tokens';

const usage = (over: Partial<Usage> = {}): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...over,
});

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 });

const assistant = (text: string, u: Usage = usage()): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic-messages',
  provider: 'p',
  model: 'm',
  usage: u,
  stopReason: 'stop',
  timestamp: 0,
});

test('estimateTokens is chars/4 rounded up', () => {
  expect(estimateTokens('')).toBe(0);
  expect(estimateTokens('abcd')).toBe(1);
  expect(estimateTokens('abcde')).toBe(2);
});

test('sizes string and array content alike', () => {
  expect(tokensOfMessage(user('aaaaaaaa'))).toBe(2);
  expect(
    tokensOfMessage({ role: 'user', content: [{ type: 'text', text: 'aaaa' }], timestamp: 0 }),
  ).toBe(1);
});

test('counts a tool call by its arguments and thinking by its text', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'aaaa' },
      { type: 'toolCall', id: '1', name: 'bash', arguments: { a: 1 } },
    ],
  } as unknown as Message;
  expect(tokensOfMessage(message)).toBe(estimateTokens('aaaa{"a":1}'));
});

test('images are charged flat, never by their base64 length', () => {
  const message = {
    role: 'toolResult',
    toolCallId: '1',
    toolName: 'screenshot',
    content: [
      { type: 'text', text: 'aaaa' },
      { type: 'image', data: 'A'.repeat(400_000), mimeType: 'image/png' },
    ],
    isError: false,
    timestamp: 0,
  } as unknown as Message;
  expect(tokensOfMessage(message)).toBe(1 + 1600);
});

test('falls back to a full estimate when no turn has reported a count', () => {
  expect(countTokens([user('aaaa'), user('aaaa')])).toBe(2);
});

test('anchors on the newest reported turn and estimates only the tail', () => {
  const messages = [
    user('aaaa'),
    assistant('x', usage({ input: 1000, output: 2, totalTokens: 1002 })),
    user('aaaaaaaa'),
  ];
  expect(countTokens(messages)).toBe(1002 + 2);
});

test('a stale anchor never wins over a newer one', () => {
  const messages = [
    assistant('x', usage({ input: 9000, output: 0, totalTokens: 9000 })),
    assistant('y', usage({ input: 1000, output: 0, totalTokens: 1000 })),
  ];
  expect(countTokens(messages)).toBe(1000);
});

test('a turn that reported nothing is not an anchor', () => {
  const messages = [assistant('aaaa'), user('aaaa')];
  expect(countTokens(messages)).toBe(estimateContextTokens(messages));
});

/** A cached prompt bills only its uncached remainder to `input`. */
test('a cache-served turn is counted at its full prompt size', () => {
  const cached = assistant(
    'x',
    usage({ input: 8_827, output: 4, cacheRead: 69_813, totalTokens: 78_644 }),
  );
  expect(countTokens([user('a'), cached])).toBe(78_644);
});

test('a turn with no reported total falls back to summing the parts', () => {
  const cached = assistant('x', usage({ input: 100, output: 5, cacheRead: 900, cacheWrite: 50 }));
  expect(countTokens([user('a'), cached])).toBe(1055);
});
