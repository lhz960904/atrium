import { expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import { injectSystemReminder } from './reminder';

const user = (text: string): UIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
});
const textOf = (m: UIMessage, i: number) => (m.parts[i] as { text: string }).text;

test('wraps the inner content in <system-reminder> and prepends to the first user message', () => {
  const out = injectSystemReminder([user('hello')], '<x>hi</x>');

  expect(out[0].parts).toHaveLength(2);
  expect(textOf(out[0], 0)).toBe('<system-reminder>\n<x>hi</x>\n</system-reminder>');
  expect(textOf(out[0], 1)).toBe('hello');
});

test('targets the first user message past leading assistant turns', () => {
  const assistant: UIMessage = {
    id: 'a',
    role: 'assistant',
    parts: [{ type: 'text', text: 'hi' }],
  };
  const out = injectSystemReminder([assistant, user('q')], 'R');

  expect(out[0]).toBe(assistant);
  expect(out[1].parts).toHaveLength(2);
  expect(textOf(out[1], 0)).toContain('R');
});

test('non-destructive: original message and array untouched', () => {
  const orig = user('hello');
  const input = [orig];
  const out = injectSystemReminder(input, 'R');

  expect(orig.parts).toHaveLength(1);
  expect(out).not.toBe(input);
  expect(out[0]).not.toBe(orig);
});

test('no user message → returns the same array', () => {
  const input: UIMessage[] = [
    { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
  ];
  expect(injectSystemReminder(input, 'R')).toBe(input);
});
