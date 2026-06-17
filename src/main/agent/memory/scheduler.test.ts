import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from './lock';
import { type DreamScheduler, dreamSweep } from './scheduler';
import { markConsolidated, recordSessionTouch } from './state';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-sched-'));
  created.push(d);
  return d;
}

const NOW = 2_000_000_000_000; // far future → 24h time gate always satisfied

async function makeDue(dir: string): Promise<void> {
  for (const id of ['s1', 's2', 's3', 's4', 's5']) await recordSessionTouch(dir, id);
}
function scheduler(dirs: string[], ran: string[]): DreamScheduler {
  return {
    listDirs: async () => dirs,
    runDream: async (dir) => {
      ran.push(dir);
    },
    model: () => ({}) as never,
    activeSessionId: () => null,
  };
}

test('runs dream only for dirs past all three gates', async () => {
  const due = await tmp();
  const notDue = await tmp();
  await makeDue(due);
  await recordSessionTouch(notDue, 's1'); // 1 session < gate → not due
  const ran: string[] = [];

  await dreamSweep(scheduler([due, notDue], ran), NOW);
  expect(ran).toEqual([due]);
});

test('skips a dir already locked by a live holder', async () => {
  const due = await tmp();
  await makeDue(due);
  await acquireLock(due, NOW); // this (live) process holds it
  const ran: string[] = [];

  await dreamSweep(scheduler([due], ran), NOW);
  expect(ran).toEqual([]);
});

test('a freshly consolidated dir is not due again (time gate)', async () => {
  const due = await tmp();
  await makeDue(due);
  await markConsolidated(due, NOW);
  const ran: string[] = [];

  // 20 min later: past the scan throttle, but well within the 24h time gate.
  await dreamSweep(scheduler([due], ran), NOW + 20 * 60_000);
  expect(ran).toEqual([]);
});
