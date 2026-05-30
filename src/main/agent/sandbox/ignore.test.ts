import { expect, test } from 'bun:test';
import { shouldIgnore } from './ignore';

test('ignores VCS / dependency / build / cache dirs', () => {
  for (const n of ['.git', 'node_modules', '__pycache__', '.venv', 'dist', '.DS_Store']) {
    expect(shouldIgnore(n)).toBe(true);
  }
});

test('ignores noisy suffixes', () => {
  expect(shouldIgnore('debug.log')).toBe(true);
  expect(shouldIgnore('x.tmp')).toBe(true);
  expect(shouldIgnore('mod.pyc')).toBe(true);
});

test('keeps normal source files and dirs', () => {
  for (const n of ['index.ts', 'src', 'README.md', 'package.json', 'lib']) {
    expect(shouldIgnore(n)).toBe(false);
  }
});
