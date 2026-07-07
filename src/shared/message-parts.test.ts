import { expect, test } from 'bun:test';
import type { ModelMessage, UIMessage } from 'ai';
import { normalizedParts, normalizeToolOutput, textOfMessage } from './message-parts';

const ui = (role: UIMessage['role'], parts: unknown[]): UIMessage =>
  ({ id: 'x', role, parts }) as unknown as UIMessage;

test('normalizeToolOutput unwraps wire encodings', () => {
  expect(normalizeToolOutput({ type: 'text', value: 'hi' })).toEqual({ text: 'hi', images: [] });
  expect(normalizeToolOutput({ type: 'error-text', value: 'boom' })).toEqual({
    text: 'boom',
    images: [],
    error: true,
  });
  expect(normalizeToolOutput({ type: 'json', value: { a: 1 } })).toEqual({
    text: '{"a":1}',
    images: [],
  });
  expect(normalizeToolOutput(undefined)).toEqual({ text: '', images: [] });
  expect(normalizeToolOutput({ some: 'object' })).toEqual({
    text: '{"some":"object"}',
    images: [],
  });
});

test('normalizeToolOutput keeps base64 out of text for image-bearing shapes', () => {
  const structured = normalizeToolOutput({
    text: 'shot',
    images: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUFBQQ==' }],
  });
  expect(structured.text).toBe('shot');
  expect(structured.images).toHaveLength(1);

  const wired = normalizeToolOutput({
    type: 'content',
    value: [
      { type: 'text', text: 'took it' },
      { type: 'image-data', data: 'QUFBQQ==', mediaType: 'image/png' },
    ],
  });
  expect(wired.text).toBe('took it');
  expect(wired.images).toHaveLength(1);
  expect(wired.images[0].mediaType).toBe('image/png');
});

test('a UI tool part with output yields a call then a result', () => {
  const msg = ui('assistant', [
    { type: 'text', text: 'running' },
    {
      type: 'tool-bash',
      toolCallId: '1',
      state: 'output-available',
      input: { cmd: 'ls' },
      output: { ok: true },
    },
  ]);
  expect(normalizedParts(msg)).toEqual([
    { kind: 'text', text: 'running' },
    { kind: 'tool-call', name: 'bash', input: { cmd: 'ls' } },
    { kind: 'tool-result', name: 'bash', output: { text: '{"ok":true}', images: [] } },
  ]);
});

test('a UI tool error yields an error result', () => {
  const msg = ui('assistant', [
    { type: 'tool-bash', toolCallId: '1', state: 'output-error', input: {}, errorText: 'nope' },
  ]);
  const parts = normalizedParts(msg);
  expect(parts[1]).toEqual({
    kind: 'tool-result',
    name: 'bash',
    output: { text: 'nope', images: [], error: true },
  });
});

test('ModelMessage content normalizes to the same part kinds', () => {
  const call: ModelMessage = {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: '1', toolName: 'read', input: { path: 'a.ts' } }],
  };
  const result = {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: '1',
        toolName: 'read',
        output: { type: 'text', value: 'code' },
      },
    ],
  } as unknown as ModelMessage;
  expect(normalizedParts(call)).toEqual([
    { kind: 'tool-call', name: 'read', input: { path: 'a.ts' } },
  ]);
  expect(normalizedParts(result)).toEqual([
    { kind: 'tool-result', name: 'read', output: { text: 'code', images: [] } },
  ]);
});

test('string ModelMessage content is a single text part', () => {
  expect(normalizedParts({ role: 'user', content: 'hello' })).toEqual([
    { kind: 'text', text: 'hello' },
  ]);
});

test('data parts carry their payload and type', () => {
  const msg = ui('assistant', [{ type: 'data-title', data: { title: 'T' } }]);
  expect(normalizedParts(msg)).toEqual([{ kind: 'data', dataType: 'title', data: { title: 'T' } }]);
});

test('textOfMessage joins only text parts', () => {
  const msg = ui('user', [
    { type: 'text', text: 'a' },
    { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,x' },
    { type: 'text', text: 'b' },
  ]);
  expect(textOfMessage(msg, ' ')).toBe('a b');
  expect(textOfMessage({ role: 'user', content: 'plain' })).toBe('plain');
});
