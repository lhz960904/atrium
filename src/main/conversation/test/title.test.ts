import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';

import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { piModels } from '../../agent/providers/registry';

afterEach(() => mock.restore());

import { cleanTitle, generateThreadTitle } from '../title';

const answering = (text: string) => {
  const model = fauxProvider().getModel();
  spyOn(piModels, 'completeSimple').mockImplementation(async (selected) => {
    expect(selected).toBe(model);
    return fauxAssistantMessage(text);
  });
  return model;
};

const user = (text: string): Message => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: 0,
});

const assistant = (): Message =>
  ({ role: 'assistant', content: [{ type: 'text', text: 'sure' }] }) as unknown as Message;

// title generation is fire-and-forget; let the microtasks run.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const run = async (messages: Message[], reply: string) => {
  const titles: string[] = [];
  generateThreadTitle({
    messages,
    model: answering(reply),
    onTitle: (title) => titles.push(title),
  });
  await flush();
  return titles;
};

test('generates a title from the first turn', async () => {
  expect(await run([user('Help me fix the login bug')], 'Fix login bug')).toEqual([
    'Fix login bug',
  ]);
});

test('strips wrapping quotes and a trailing period the model adds', () => {
  expect(cleanTitle('"Sort an array."')).toBe('Sort an array');
  expect(cleanTitle('Title\nsecond line')).toBe('Title');
});

test('skips generation when the turn is not the first (assistant present)', async () => {
  expect(await run([user('hi'), assistant(), user('next')], 'Nope')).toEqual([]);
});

test('skips generation when the first user message has no text', async () => {
  expect(await run([user('   ')], 'X')).toEqual([]);
});

test('a failed call leaves the fallback title in place', async () => {
  const titles: string[] = [];
  const model = fauxProvider().getModel();
  spyOn(piModels, 'completeSimple').mockRejectedValue(new Error('unreachable'));
  generateThreadTitle({
    messages: [user('hi')],
    model,
    onTitle: (t) => titles.push(t),
  });
  await flush();
  expect(titles).toEqual([]);
});
