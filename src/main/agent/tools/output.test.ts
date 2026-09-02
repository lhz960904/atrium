import { expect, test } from 'bun:test';
import { fsError } from './output';

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

test('maps fs codes to readable messages, varying only the EACCES verb', () => {
  expect(fsError(errno('ENOENT'), 'a.ts', 'reading').message).toBe('File not found: a.ts');
  expect(fsError(errno('EISDIR'), 'src', 'editing').message).toBe(
    'Path is a directory, not a file: src',
  );
  expect(fsError(errno('EACCES'), 'a.ts', 'reading').message).toBe(
    'Permission denied reading file: a.ts',
  );
  expect(fsError(errno('EACCES'), 'a.ts', 'writing to').message).toBe(
    'Permission denied writing to file: a.ts',
  );
  expect(fsError(errno('EACCES'), 'a.ts', 'editing').message).toBe(
    'Permission denied editing file: a.ts',
  );
});

test('falls back to the raw error for unknown failures', () => {
  const original = new Error('disk full');
  expect(fsError(original, 'a.ts', 'writing to')).toBe(original);
  expect(fsError('weird', 'a.ts', 'reading').message).toBe('weird');
});
