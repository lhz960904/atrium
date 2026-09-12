import { expect, test } from 'bun:test';
import type { Message } from '@shared/protocol';
import { withModelAttachments } from './attachments';

const userWith = (...content: unknown[]): Message =>
  ({ role: 'user', content, timestamp: 0 }) as unknown as Message;

const contentOf = (message: Message): Record<string, unknown>[] =>
  (message as unknown as { content: Record<string, unknown>[] }).content;

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

test('an image attachment becomes engine image content', () => {
  const out = withModelAttachments(
    userWith(
      { type: 'text', text: 'what is this?' },
      {
        type: 'file',
        url: 'data:image/png;base64,QUFBQQ==',
        mediaType: 'image/png',
        filename: 'shot.png',
      },
    ),
  );
  expect(contentOf(out)).toEqual([
    { type: 'text', text: 'what is this?' },
    { type: 'image', data: 'QUFBQQ==', mimeType: 'image/png' },
  ]);
});

test('a text attachment is decoded and labelled, not left as base64', () => {
  const out = withModelAttachments(
    userWith({
      type: 'file',
      url: `data:text/plain;base64,${b64('export const x = 1;')}`,
      mediaType: 'text/plain',
      filename: 'x.ts',
    }),
  );
  const [part] = contentOf(out);
  expect(part.type).toBe('text');
  expect(part.text).toBe('<attachment name="x.ts">\nexport const x = 1;\n</attachment>');
});

test('a type the engine cannot carry becomes a note naming the file', () => {
  const out = withModelAttachments(
    userWith({
      type: 'file',
      url: 'data:application/pdf;base64,JVBERi0=',
      mediaType: 'application/pdf',
      filename: 'spec.pdf',
    }),
  );
  const [part] = contentOf(out);
  expect(part.type).toBe('text');
  expect(part.text).toContain('spec.pdf');
  expect(part.text).toContain('application/pdf');
  // The payload must not ride along as text — that is what blew the request up.
  expect(part.text).not.toContain('JVBERi0=');
});

test('a non-data url degrades to a note instead of an empty image block', () => {
  const out = withModelAttachments(
    userWith({
      type: 'file',
      url: 'https://example.com/a.png',
      mediaType: 'image/png',
      filename: 'a.png',
    }),
  );
  expect(contentOf(out)[0].type).toBe('text');
});

test('messages without attachments are returned untouched', () => {
  const message = userWith({ type: 'text', text: 'hi' });
  expect(withModelAttachments(message)).toBe(message);
});

test('a string-content message is left alone', () => {
  const message = { role: 'user', content: 'hi', timestamp: 0 } as unknown as Message;
  expect(withModelAttachments(message)).toBe(message);
});
