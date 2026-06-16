import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteMemory, fileName, parseTopic, renderTopic, writeMemory } from './store';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-'));
  created.push(d);
  return d;
}
const readMd = (dir: string, file: string) => readFile(join(dir, file), 'utf8');

test('fileName slugs and is traversal-proof', () => {
  expect(fileName('Comment Style')).toBe('comment-style.md');
  expect(fileName('../../etc/passwd')).toBe('etc-passwd.md');
  expect(fileName('  Build Command!! ')).toBe('build-command.md');
});

test('renderTopic emits fixed frontmatter that round-trips', () => {
  const md = renderTopic({
    name: 'Comment Style',
    description: 'hates multi-line comments',
    type: 'preference',
    body: 'no multi-line.',
  });
  expect(md.startsWith('---\n')).toBe(true);
  expect(parseTopic(md)).toEqual({
    name: 'Comment Style',
    description: 'hates multi-line comments',
    type: 'preference',
  });
});

test('write creates the topic file AND an index line', async () => {
  const dir = await tmp();
  await writeMemory(dir, {
    name: 'Comment Style',
    description: 'hates multi-line comments',
    type: 'preference',
    body: 'no multi-line.',
  });
  expect(await readMd(dir, 'comment-style.md')).toContain('no multi-line.');
  const index = await readMd(dir, 'MEMORY.md');
  expect(index).toContain('## preference');
  expect(index).toContain('- Comment Style — hates multi-line comments');
});

test('index rebuilds: grouped by type, names sorted', async () => {
  const dir = await tmp();
  await writeMemory(dir, { name: 'Build Cmd', description: 'use bun', type: 'project', body: 'x' });
  await writeMemory(dir, {
    name: 'Comment Style',
    description: 'no multiline',
    type: 'preference',
    body: 'x',
  });
  await writeMemory(dir, { name: 'Aliases', description: 'g=git', type: 'preference', body: 'x' });
  const index = await readMd(dir, 'MEMORY.md');
  expect(index).toContain('## preference');
  expect(index).toContain('## project');
  expect(index.indexOf('- Aliases')).toBeLessThan(index.indexOf('- Comment Style'));
});

test('re-writing the same name replaces it, not duplicates', async () => {
  const dir = await tmp();
  await writeMemory(dir, { name: 'Build Cmd', description: 'old', type: 'project', body: 'x' });
  await writeMemory(dir, { name: 'Build Cmd', description: 'new', type: 'project', body: 'y' });
  const index = await readMd(dir, 'MEMORY.md');
  expect(index).toContain('- Build Cmd — new');
  expect(index).not.toContain('old');
  expect((index.match(/- Build Cmd/g) ?? []).length).toBe(1);
});

test('delete removes the file and its index line', async () => {
  const dir = await tmp();
  await writeMemory(dir, { name: 'Temp', description: 'gone soon', type: 'project', body: 'x' });
  await deleteMemory(dir, 'Temp');
  expect(await readMd(dir, 'MEMORY.md')).not.toContain('Temp');
});
