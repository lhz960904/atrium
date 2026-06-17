import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DREAM_GATES, DREAM_SCAN_THROTTLE_MS } from './paths';

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
 * Record that a session touched this scope, for the consolidation gate (deduped).
 * No-op when the scope dir doesn't exist yet — there's nothing to consolidate there.
 */
async function writeState(dir: string, s: MemoryState): Promise<void> {
  await writeFile(join(dir, STATE_FILE), JSON.stringify(s), 'utf8');
}

export async function recordSessionTouch(dir: string, sessionId: string): Promise<void> {
  const s = await readState(dir);
  if (s.touchedSessions.includes(sessionId)) return;
  s.touchedSessions.push(sessionId);
  try {
    await writeState(dir, s);
  } catch {
    // scope dir absent (no memories yet) → skip
  }
}

/**
 * The consolidation gate, mirroring Claude's auto-dream: a scan throttle, then a
 * time-since-last-consolidation gate, then a distinct-session-count gate (the active
 * session is excluded so we never consolidate one still being written). Records the
 * scan time as a side effect, so the throttle holds across calls.
 */
export async function shouldConsolidate(
  dir: string,
  now: number,
  activeSessionId?: string,
): Promise<boolean> {
  const s = await readState(dir);
  if (now - s.lastScanAt < DREAM_SCAN_THROTTLE_MS) return false;
  await writeState(dir, { ...s, lastScanAt: now });
  if (now - s.lastConsolidatedAt < DREAM_GATES.minHours * 3_600_000) return false;
  return s.touchedSessions.filter((id) => id !== activeSessionId).length >= DREAM_GATES.minSessions;
}

export async function markConsolidated(dir: string, now: number): Promise<void> {
  await writeState(dir, { lastConsolidatedAt: now, lastScanAt: now, touchedSessions: [] });
}
