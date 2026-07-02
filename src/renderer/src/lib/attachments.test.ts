import { expect, test } from 'bun:test';
import { classifyAttachment, filesFromTransfer, pastedName } from './attachments';

const file = (name: string, type: string): File => new File(['x'], name, { type });

// filesFromTransfer only reads `.files` and `.items`, so a plain object with
// those two is a sufficient stand-in for a real ClipboardData/DataTransfer.
const transfer = (over: {
  files?: File[];
  items?: Array<{ kind: string; getAsFile: () => File | null }>;
}): DataTransfer =>
  ({ files: over.files ?? [], items: over.items ?? [] }) as unknown as DataTransfer;

test('filesFromTransfer is null-safe', () => {
  expect(filesFromTransfer(null)).toEqual([]);
});

test('filesFromTransfer prefers the files list', () => {
  const f = file('a.png', 'image/png');
  expect(filesFromTransfer(transfer({ files: [f] }))).toEqual([f]);
});

test('filesFromTransfer falls back to file items when files is empty', () => {
  const f = file('shot.png', 'image/png');
  expect(filesFromTransfer(transfer({ items: [{ kind: 'file', getAsFile: () => f }] }))).toEqual([
    f,
  ]);
});

test('filesFromTransfer ignores string items (plain text paste)', () => {
  expect(
    filesFromTransfer(transfer({ items: [{ kind: 'string', getAsFile: () => null }] })),
  ).toEqual([]);
});

test('pastedName maps media types to a sensible filename', () => {
  expect(pastedName('image/png')).toBe('pasted.png');
  expect(pastedName('image/jpeg')).toBe('pasted.jpg');
  expect(pastedName('application/pdf')).toBe('pasted.pdf');
  expect(pastedName('application/x-unknown')).toBe('pasted.bin');
});

test('classifyAttachment resolves a nameless pasted image via file.type', () => {
  // A clipboard image can arrive with an empty name; the browser guarantees
  // File.name is a string, so a plain stand-in models that faithfully.
  expect(classifyAttachment({ name: '', type: 'image/png' } as File)).toBe('image/png');
});
