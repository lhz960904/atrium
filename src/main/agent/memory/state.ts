import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DREAM_GATES = { minHours: 24, minSessions: 5 }; // borrowed from Claude's auto-dream
const DREAM_SCAN_THROTTLE_MS = 10 * 60_000; // don't re-scan a dir within this window

export type MemoryState = {
  lastConsolidatedAt: number;
  lastScanAt: number;
  touchedSessions: string[];
};

const STATE_FILE = '.state.json';

export async function readState(dir: string): Promise<MemoryState> {
  try {
    const raw = JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8')) as Partial<MemoryState>;
    return {
      lastConsolidatedAt: raw.lastConsolidatedAt ?? 0,
      lastScanAt: raw.lastScanAt ?? 0,
      touchedSessions: Array.isArray(raw.touchedSessions) ? [...raw.touchedSessions] : [],
    };
  } catch {
    return { lastConsolidatedAt: 0, lastScanAt: 0, touchedSessions: [] };
  }
}

/**
 * Persist memory state. No-ops when the scope dir is absent (memories were
 * deleted, or none written yet): there's nothing to consolidate there, so every
 * caller — including the dream sweep — must tolerate a missing dir rather than
 * crash on ENOENT. Other write errors still propagate.
 */
async function writeState(dir: string, s: MemoryState): Promise<void> {
  try {
    await writeFile(join(dir, STATE_FILE), JSON.stringify(s), 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
}

export async function recordSessionTouch(dir: string, sessionId: string): Promise<void> {
  const s = await readState(dir);
  if (s.touchedSessions.includes(sessionId)) return;
  s.touchedSessions.push(sessionId);
  await writeState(dir, s);
}

/**
 * The consolidation gate, mirroring Claude's auto-dream: a scan throttle, then a
 * time-since-last-consolidation gate, then a distinct-session-count gate. Records
 * the scan time as a side effect, so the throttle holds across calls.
 */
export async function shouldConsolidate(dir: string, now: number): Promise<boolean> {
  const s = await readState(dir);
  if (now - s.lastScanAt < DREAM_SCAN_THROTTLE_MS) return false;
  await writeState(dir, { ...s, lastScanAt: now });
  if (now - s.lastConsolidatedAt < DREAM_GATES.minHours * 3_600_000) return false;
  return s.touchedSessions.length >= DREAM_GATES.minSessions;
}

export async function markConsolidated(dir: string, now: number): Promise<void> {
  await writeState(dir, { lastConsolidatedAt: now, lastScanAt: now, touchedSessions: [] });
}
