import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
export async function recordSessionTouch(dir: string, sessionId: string): Promise<void> {
  const s = await readState(dir);
  if (s.touchedSessions.includes(sessionId)) return;
  s.touchedSessions.push(sessionId);
  try {
    await writeFile(join(dir, STATE_FILE), JSON.stringify(s), 'utf8');
  } catch {
    // scope dir absent (no memories yet) → skip
  }
}
