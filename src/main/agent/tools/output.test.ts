import { expect, test } from 'bun:test';
import { fsErrorMessage } from './output';

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

test('maps fs codes to readable messages, varying only the EACCES verb', () => {
  expect(fsErrorMessage(errno('ENOENT'), 'a.ts', 'reading')).toBe('Error: File not found: a.ts');
  expect(fsErrorMessage(errno('EISDIR'), 'src', 'editing')).toBe(
    'Error: Path is a directory, not a file: src',
  );
  expect(fsErrorMessage(errno('EACCES'), 'a.ts', 'reading')).toBe(
    'Error: Permission denied reading file: a.ts',
  );
  expect(fsErrorMessage(errno('EACCES'), 'a.ts', 'writing to')).toBe(
    'Error: Permission denied writing to file: a.ts',
  );
  expect(fsErrorMessage(errno('EACCES'), 'a.ts', 'editing')).toBe(
    'Error: Permission denied editing file: a.ts',
  );
});

test('falls back to the raw message for unknown errors', () => {
  expect(fsErrorMessage(new Error('disk full'), 'a.ts', 'writing to')).toBe('Error: disk full');
  expect(fsErrorMessage('weird', 'a.ts', 'reading')).toBe('Error: weird');
});
