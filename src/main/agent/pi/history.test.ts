import { expect, test } from 'bun:test';
import type { AssistantMessage, Message, ToolResultMessage } from '@shared/protocol';
import { sealDanglingToolCalls, withSettledResults } from './history';

const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const calling = (...ids: string[]): AssistantMessage => ({
  role: 'assistant',
  content: ids.map((id) => ({ type: 'toolCall', id, name: 'ask_clarification', arguments: {} })),
  api: 'a',
  provider: 'p',
  model: 'm',
  usage: zeroUsage(),
  stopReason: 'toolUse',
  timestamp: 2,
});

const answer = (toolCallId: string, text: string): ToolResultMessage => ({
  role: 'toolResult',
  toolCallId,
  toolName: 'ask_clarification',
  content: [{ type: 'text', text }],
  details: text,
  isError: false,
  timestamp: 3,
});

const resultsFor = (messages: Message[], id: string): ToolResultMessage[] =>
  messages.filter((m): m is ToolResultMessage => m.role === 'toolResult' && m.toolCallId === id);

test('an unanswered call is sealed so the transcript stays valid', () => {
  const sealed = sealDanglingToolCalls([calling('c1')]);
  expect(resultsFor(sealed, 'c1')).toHaveLength(1);
  expect(resultsFor(sealed, 'c1')[0].isError).toBe(true);
});

test('a settled decision replaces the seal rather than joining it', () => {
  // What a resumed run actually starts from: the reader has already sealed the
  // call the previous turn parked, and now the user's answer arrives for it.
  const history = sealDanglingToolCalls([calling('c1')]);
  const messages = withSettledResults(history, [answer('c1', 'blue')]);

  const results = resultsFor(messages, 'c1');
  expect(results).toHaveLength(1);
  expect(results[0].details).toBe('blue');
  // The answer has to sit after the turn that asked for it.
  expect(messages.at(-1)).toBe(results[0]);
});

test('results for other calls are left where they are', () => {
  const history: Message[] = [calling('c1', 'c2'), answer('c1', 'kept')];
  const messages = withSettledResults(history, [answer('c2', 'new')]);
  expect(resultsFor(messages, 'c1')).toHaveLength(1);
  expect(resultsFor(messages, 'c2')).toHaveLength(1);
  expect(messages).toHaveLength(3);
});

test('nothing settled leaves the transcript untouched', () => {
  const history: Message[] = [calling('c1')];
  expect(withSettledResults(history, [])).toBe(history);
});
