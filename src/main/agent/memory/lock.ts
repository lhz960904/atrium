import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_FILE = '.consolidate-lock';
const STALE_MS = 10 * 60_000;

type Lock = { pid: number; startedAt: number };

async function readLock(dir: string): Promise<Lock | null> {
  try {
    return JSON.parse(await readFile(join(dir, LOCK_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** A process exists unless kill(pid, 0) raises ESRCH; EPERM means it's alive but not ours. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Take the consolidation lock unless a live, non-stale holder already has it. */
export async function acquireLock(dir: string, now: number): Promise<boolean> {
  const cur = await readLock(dir);
  if (cur && isAlive(cur.pid) && now - cur.startedAt < STALE_MS) return false;
  await writeFile(
    join(dir, LOCK_FILE),
    JSON.stringify({ pid: process.pid, startedAt: now }),
    'utf8',
  );
  return true;
}

export async function releaseLock(dir: string): Promise<void> {
  await rm(join(dir, LOCK_FILE), { force: true });
}
