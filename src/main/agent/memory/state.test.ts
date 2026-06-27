import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markConsolidated, readState, recordSessionTouch, shouldConsolidate } from './state';

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

const HOUR = 3_600_000;
const NOW = 2_000_000_000_000;
const seedSessions = async (dir: string, ids: string[]) => {
  for (const id of ids) await recordSessionTouch(dir, id);
};

test('shouldConsolidate: all gates pass → true; markConsolidated resets the counter', async () => {
  const dir = await tmp();
  await seedSessions(dir, ['s1', 's2', 's3', 's4', 's5']);
  expect(await shouldConsolidate(dir, NOW)).toBe(true);
  await markConsolidated(dir, NOW);
  expect(await shouldConsolidate(dir, NOW + 25 * HOUR)).toBe(false); // counter reset → session gate fails
});

test('shouldConsolidate: too few distinct sessions → false', async () => {
  const dir = await tmp();
  await seedSessions(dir, ['s1', 's2', 's3']);
  expect(await shouldConsolidate(dir, NOW)).toBe(false);
});

test('shouldConsolidate: scan throttle blocks a second call within the window', async () => {
  const dir = await tmp();
  await seedSessions(dir, ['s1', 's2', 's3', 's4', 's5']);
  expect(await shouldConsolidate(dir, NOW)).toBe(true);
  expect(await shouldConsolidate(dir, NOW + 60_000)).toBe(false); // 1 min later → throttled
});

// A deleted/never-created scope dir (e.g. after a memory reset) must not crash
// the dream sweep — writeState swallows ENOENT for every caller.
test('shouldConsolidate on a missing dir returns false, not a throw', async () => {
  const missing = join(tmpdir(), 'mem-state-nope-xyz', 'inner');
  expect(await shouldConsolidate(missing, NOW)).toBe(false);
});

test('markConsolidated on a missing dir is a no-op, not a throw', async () => {
  await markConsolidated(join(tmpdir(), 'mem-state-nope-xyz', 'inner'), NOW);
});
