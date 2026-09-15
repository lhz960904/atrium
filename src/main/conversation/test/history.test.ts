import { expect, test } from 'bun:test';
import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';

import { sealDanglingToolCalls } from '../history';

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

test('a transcript whose calls all have results is left as it is', () => {
  const history: Message[] = [calling('c1', 'c2'), answer('c1', 'one'), answer('c2', 'two')];
  expect(sealDanglingToolCalls(history)).toEqual(history);
});

test('sealing twice adds nothing the first pass did not', () => {
  const once = sealDanglingToolCalls([calling('c1')]);
  expect(sealDanglingToolCalls(once)).toEqual(once);
});
