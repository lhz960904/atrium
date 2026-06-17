import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, recordSessionTouch } from './state';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-state-'));
  created.push(d);
  return d;
}

test('records distinct sessions and dedupes repeats', async () => {
  const dir = await tmp();
  await recordSessionTouch(dir, 'a');
  await recordSessionTouch(dir, 'a');
  await recordSessionTouch(dir, 'b');
  expect((await readState(dir)).touchedSessions).toEqual(['a', 'b']);
});

test('readState returns empty defaults when there is no state file', async () => {
  const dir = await tmp();
  expect(await readState(dir)).toEqual({
    lastConsolidatedAt: 0,
    lastScanAt: 0,
    touchedSessions: [],
  });
});

test('recordSessionTouch on a missing dir is a no-op, not a throw', async () => {
  await recordSessionTouch(join(tmpdir(), 'mem-state-nope-xyz', 'inner'), 'a');
});
