import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock } from './lock';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-lock-'));
  created.push(d);
  return d;
}
const writeLock = (dir: string, lock: object) =>
  writeFile(join(dir, '.consolidate-lock'), JSON.stringify(lock), 'utf8');
const NOW = 1_700_000_000_000;

test('acquires a free lock, then blocks a second live holder', async () => {
  const dir = await tmp();
  expect(await acquireLock(dir, NOW)).toBe(true); // writes our (live) pid
  expect(await acquireLock(dir, NOW)).toBe(false); // held by a live pid, fresh
});

test('re-acquires once a held lock goes stale', async () => {
  const dir = await tmp();
  await writeLock(dir, { pid: process.pid, startedAt: NOW - 11 * 60_000 });
  expect(await acquireLock(dir, NOW)).toBe(true); // > 10 min old → stale
});

test('re-acquires when the holder pid is dead', async () => {
  const dir = await tmp();
  await writeLock(dir, { pid: 2 ** 31 - 1, startedAt: NOW }); // no such process → ESRCH
  expect(await acquireLock(dir, NOW)).toBe(true);
});

test('release frees the lock', async () => {
  const dir = await tmp();
  await acquireLock(dir, NOW);
  await releaseLock(dir);
  expect(await acquireLock(dir, NOW)).toBe(true);
});
