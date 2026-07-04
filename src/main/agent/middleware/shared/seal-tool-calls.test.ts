import { expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import { sealDanglingToolCalls, sealMessageToolCalls } from './seal-tool-calls';

function assistant(parts: unknown[]): UIMessage {
  return { id: 'm1', role: 'assistant', parts } as UIMessage;
}

test('seals an input-available tool call to output-error, preserving id/input', () => {
  const msg = assistant([
    { type: 'tool-web_search', toolCallId: 'c1', state: 'input-available', input: { query: 'x' } },
  ]);
  const [part] = sealMessageToolCalls(msg).parts as Array<Record<string, unknown>>;
  expect(part.state).toBe('output-error');
  expect(part.errorText).toBeTruthy();
  expect(part.toolCallId).toBe('c1');
  expect(part.input).toEqual({ query: 'x' });
});

test('seals input-streaming and dynamic-tool calls too', () => {
  const msg = assistant([
    { type: 'tool-bash', toolCallId: 'c2', state: 'input-streaming', input: {} },
    { type: 'dynamic-tool', toolName: 'mcp__x__y', toolCallId: 'c3', state: 'input-available' },
  ]);
  const parts = sealMessageToolCalls(msg).parts as Array<Record<string, unknown>>;
  expect(parts[0].state).toBe('output-error');
  expect(parts[1].state).toBe('output-error');
});

test('leaves resolved tool calls, text, and user messages untouched (same reference)', () => {
  const done = assistant([
    { type: 'text', text: 'hi', state: 'done' },
    { type: 'tool-web_search', toolCallId: 'c4', state: 'output-available', output: 'r' },
    { type: 'tool-web_fetch', toolCallId: 'c5', state: 'output-error', errorText: 'boom' },
  ]);
  expect(sealMessageToolCalls(done)).toBe(done);

  const user = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'q' }] } as UIMessage;
  expect(sealMessageToolCalls(user)).toBe(user);
});

test('sealDanglingToolCalls only rebuilds the messages that had a dangling call', () => {
  const clean = assistant([
    { type: 'tool-web_search', toolCallId: 'a', state: 'output-available' },
  ]);
  const dirty = assistant([{ type: 'tool-web_search', toolCallId: 'b', state: 'input-available' }]);
  const out = sealDanglingToolCalls([clean, dirty]);
  expect(out[0]).toBe(clean);
  expect(out[1]).not.toBe(dirty);
  expect((out[1].parts[0] as Record<string, unknown>).state).toBe('output-error');
});
