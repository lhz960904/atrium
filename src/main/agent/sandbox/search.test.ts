import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globFiles, grepFiles } from './search';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atrium-search-'));
  await mkdir(join(root, 'src', 'nested'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true });
  await writeFile(join(root, 'a.ts'), 'const foo = 1;\n// TODO: clean up\n');
  await writeFile(join(root, 'pkg.json'), '{ "name": "x" }\n');
  await writeFile(join(root, 'src', 'b.ts'), 'function foo() {}\nconst bar = 2;\n');
  await writeFile(join(root, 'src', 'nested', 'c.ts'), 'FOO uppercase\n');
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'foo in a dep\n');
  // Binary file: a NUL byte makes grep skip it.
  await writeFile(join(root, 'bin.dat'), Buffer.from([0x66, 0x6f, 0x6f, 0x00, 0x66]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('glob **/*.ts matches nested and root, skipping node_modules', async () => {
  const r = await globFiles(root, { pattern: '**/*.ts' });
  expect(r.paths.sort()).toEqual(['a.ts', 'src/b.ts', 'src/nested/c.ts']);
  expect(r.truncated).toBe(false);
});

test('glob *.ts matches only the root level (no ** = current dir)', async () => {
  const r = await globFiles(root, { pattern: '*.ts' });
  expect(r.paths).toEqual(['a.ts']);
});

test('glob truncates at maxResults', async () => {
  const r = await globFiles(root, { pattern: '**/*.ts', maxResults: 2 });
  expect(r.paths.length).toBe(2);
  expect(r.truncated).toBe(true);
});

test('grep finds matches as file/line/text, case-insensitive by default', async () => {
  const r = await grepFiles(root, { pattern: 'foo' });
  const hits = r.matches.map((m) => `${m.file}:${m.line}`).sort();
  // a.ts (const foo), src/b.ts (function foo), src/nested/c.ts (FOO) — NOT node_modules, NOT bin.dat
  expect(hits).toEqual(['a.ts:1', 'src/b.ts:1', 'src/nested/c.ts:1']);
});

test('grep case_sensitive excludes the uppercase match', async () => {
  const r = await grepFiles(root, { pattern: 'foo', caseSensitive: true });
  expect(r.matches.some((m) => m.file === 'src/nested/c.ts')).toBe(false);
  expect(r.matches.some((m) => m.file === 'a.ts')).toBe(true);
});

test('grep glob filter scopes which files are searched', async () => {
  const r = await grepFiles(root, { pattern: 'foo', glob: 'src/**/*.ts' });
  expect(r.matches.map((m) => m.file).sort()).toEqual(['src/b.ts', 'src/nested/c.ts']);
});

test('grep literal treats regex metacharacters as plain text', async () => {
  const r = await grepFiles(root, { pattern: 'foo()', literal: true });
  // matches the literal "foo()" in src/b.ts, not the regex foo+empty-group
  expect(r.matches.map((m) => m.file)).toEqual(['src/b.ts']);
});

test('grep path scopes the search to a subdirectory', async () => {
  const r = await grepFiles(root, { pattern: 'foo', path: 'src' });
  expect(r.matches.every((m) => m.file.startsWith('src/'))).toBe(true);
  expect(r.matches.length).toBe(2);
});

test('grep returns the matched line text', async () => {
  const r = await grepFiles(root, { pattern: 'TODO' });
  expect(r.matches).toEqual([{ file: 'a.ts', line: 2, text: '// TODO: clean up' }]);
});
