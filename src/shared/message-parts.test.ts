import { expect, test } from 'bun:test';
import type { AtriumUIMessage } from './chat';
import { normalizedParts, normalizeToolOutput, textOfMessage } from './message-parts';

const ui = (role: AtriumUIMessage['role'], parts: unknown[]): AtriumUIMessage =>
  ({ id: 'x', role, parts }) as unknown as AtriumUIMessage;

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
});
