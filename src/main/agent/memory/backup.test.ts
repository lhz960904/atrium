import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearSnapshot, rollback, snapshot } from './backup';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-bak-'));
  created.push(d);
  return d;
}

test('rollback restores modified files and removes ones added since the snapshot', async () => {
  const dir = await tmp();
  await writeFile(join(dir, 'MEMORY.md'), 'original', 'utf8');
  await snapshot(dir);

  await writeFile(join(dir, 'MEMORY.md'), 'changed by dream', 'utf8');
  await writeFile(join(dir, 'extra.md'), 'a file the dream added', 'utf8');
  await rollback(dir);

  expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toBe('original');
  await expect(readFile(join(dir, 'extra.md'), 'utf8')).rejects.toThrow(); // removed on restore
});

test('clearSnapshot drops the backup after a successful run', async () => {
  const dir = await tmp();
  await writeFile(join(dir, 'MEMORY.md'), 'kept', 'utf8');
  await snapshot(dir);
  await clearSnapshot(dir);
  // the live dir is untouched by clearing the backup
  expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toBe('kept');
});
