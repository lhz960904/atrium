import { expect, test } from 'bun:test';
import { resolveAbsolute, resolveInWorkspace } from './paths';

const ROOT = '/work/space';

test('resolves a normal relative path inside the root', () => {
  expect(resolveInWorkspace(ROOT, 'src/a.ts')).toBe('/work/space/src/a.ts');
});

test('allows the root itself', () => {
  expect(resolveInWorkspace(ROOT, '.')).toBe(ROOT);
  expect(resolveInWorkspace(ROOT, '/work/space/src/a.ts')).toBe('/work/space/src/a.ts');
});

test('rejects `..` traversal escapes', () => {
  expect(() => resolveInWorkspace(ROOT, '../secret')).toThrow('escapes the workspace');
  expect(() => resolveInWorkspace(ROOT, 'a/../../b')).toThrow('escapes the workspace');
});

test('rejects absolute paths outside the root', () => {
  expect(() => resolveInWorkspace(ROOT, '/etc/passwd')).toThrow('escapes the workspace');
});

test('rejects a sibling dir sharing a name prefix', () => {
  expect(() => resolveInWorkspace(ROOT, '../space-evil')).toThrow('escapes the workspace');
});

test('resolveAbsolute resolves under the root without a boundary check', () => {
  expect(resolveAbsolute(ROOT, 'src/a.ts')).toBe('/work/space/src/a.ts');
  expect(resolveAbsolute(ROOT, '.')).toBe(ROOT);
});

test('resolveAbsolute lets paths reach outside the root (reads + gated writes)', () => {
  expect(resolveAbsolute(ROOT, '../secret')).toBe('/work/secret');
  expect(resolveAbsolute(ROOT, '/etc/passwd')).toBe('/etc/passwd');
});
