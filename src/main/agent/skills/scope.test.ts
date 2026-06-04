import { expect, test } from 'bun:test';
import type { ToolName } from '@shared/tools';
import { resolveToolName, scopeToolsForSkill } from './scope';

const AVAILABLE: ToolName[] = [
  'read_file',
  'write_file',
  'list_dir',
  'bash',
  'todo_write',
  'web_fetch',
  'web_search',
  'task',
  'skill',
];

test('resolves our own snake_case names directly', () => {
  expect(resolveToolName('read_file', AVAILABLE)).toBe('read_file');
  expect(resolveToolName('web_search', AVAILABLE)).toBe('web_search');
});

test('matches across case and separators (WebFetch ↔ web_fetch)', () => {
  expect(resolveToolName('WebFetch', AVAILABLE)).toBe('web_fetch');
  expect(resolveToolName('Bash', AVAILABLE)).toBe('bash');
  expect(resolveToolName('WEB_SEARCH', AVAILABLE)).toBe('web_search');
  expect(resolveToolName('TodoWrite', AVAILABLE)).toBe('todo_write');
});

test('maps foreign aliases (Read/Edit/shell)', () => {
  expect(resolveToolName('Read', AVAILABLE)).toBe('read_file');
  expect(resolveToolName('Write', AVAILABLE)).toBe('write_file');
  expect(resolveToolName('Edit', AVAILABLE)).toBe('write_file');
  expect(resolveToolName('shell', AVAILABLE)).toBe('bash');
});

test('returns null for names that map to nothing we have', () => {
  expect(resolveToolName('Glob', AVAILABLE)).toBeNull();
  expect(resolveToolName('mcp__foo__bar', AVAILABLE)).toBeNull();
});

test('scope: our names intersect to a whitelist', () => {
  expect(scopeToolsForSkill(['read_file', 'bash'], AVAILABLE)).toEqual(['read_file', 'bash']);
});

test('scope: foreign names map then intersect', () => {
  expect(scopeToolsForSkill(['Read', 'Bash', 'WebFetch'], AVAILABLE)).toEqual([
    'read_file',
    'bash',
    'web_fetch',
  ]);
});

test('scope: dedupes when two declarations resolve to the same tool', () => {
  expect(scopeToolsForSkill(['Read', 'read_file'], AVAILABLE)).toEqual(['read_file']);
});

test('scope: keeps only the mapped names, dropping unmappable ones', () => {
  expect(scopeToolsForSkill(['Read', 'Glob', 'mcp__x'], AVAILABLE)).toEqual(['read_file']);
});

test('scope: no constraint (null) when nothing maps — never an empty ban-all', () => {
  expect(scopeToolsForSkill(['Glob', 'mcp__x'], AVAILABLE)).toBeNull();
});

test('scope: no constraint when allowed is undefined or empty', () => {
  expect(scopeToolsForSkill(undefined, AVAILABLE)).toBeNull();
  expect(scopeToolsForSkill([], AVAILABLE)).toBeNull();
});
