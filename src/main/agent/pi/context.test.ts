import { expect, test } from 'bun:test';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { composeContext } from './context';

const user = (text: string): AgentMessage => ({ role: 'user', content: text, timestamp: 0 });

const append = (text: string) => (messages: AgentMessage[]) => [...messages, user(text)];

const textsOf = (messages: AgentMessage[]) =>
  messages.map((m) => ('content' in m ? (m.content as string) : ''));

test('runs transforms in order, each on the previous output', async () => {
  const transform = composeContext([append('a'), append('b')]);
  expect(textsOf(await transform([user('start')]))).toEqual(['start', 'a', 'b']);
});

test('skips absent entries so a caller can compose conditionally', async () => {
  const transform = composeContext([append('a'), false, undefined, append('b')]);
  expect(textsOf(await transform([]))).toEqual(['a', 'b']);
});

test('a throwing transform is skipped and the chain continues', async () => {
  const transform = composeContext([
    append('a'),
    () => {
      throw new Error('boom');
    },
    append('b'),
  ]);
  expect(textsOf(await transform([]))).toEqual(['a', 'b']);
});
