import { expect, test } from 'bun:test';
import { encodeWorkspace } from './paths';

test('encodes a posix path to a reverse-readable dir name', () => {
  expect(encodeWorkspace('/Users/x/Documents/projects/atrium')).toBe(
    '-Users-x-Documents-projects-atrium',
  );
});

test('collapses repeated separators', () => {
  expect(encodeWorkspace('/Users//x/proj')).toBe('-Users-x-proj');
});

test('encodes a windows path (drive colon + backslashes)', () => {
  expect(encodeWorkspace('C:\\Users\\x\\proj')).toBe('C-Users-x-proj');
});
