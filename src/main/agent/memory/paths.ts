import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type MemoryScope = 'global' | 'project';

export const MEMORY_INDEX = 'MEMORY.md';
export const MEMORY_SCOPES: MemoryScope[] = ['global', 'project']; // broad → specific
export const MEMORY_INDEX_BUDGET = 25 * 1024; // injected index byte budget, per scope

export const DREAM_GATES = { minHours: 24, minSessions: 5 }; // borrowed from Claude's auto-dream
export const DREAM_SCAN_THROTTLE_MS = 10 * 60_000; // don't re-scan a dir within this window
export const DREAM_SCAN_INTERVAL_MS = 30 * 60_000; // background sweep period

// Lazy require: electron only exists in the app runtime, so importing it at the
// top would make this module (and the memory tool) unloadable under bun/tests.
function memoryBase(): string {
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'memory');
}

export function memoryDir(scope: MemoryScope, workspaceRoot: string): string {
  if (scope === 'global') return join(memoryBase(), 'global');
  return join(memoryBase(), 'projects', encodeWorkspace(workspaceRoot));
}

// Workspace path → directory name (like Claude Code: '/' → '-'), so the dir name reverse-reads to the project.
export function encodeWorkspace(workspaceRoot: string): string {
  return workspaceRoot.replace(/[:\\/]+/g, '-');
}

/** Every memory dir on disk (global + each project), for the background sweep. */
export async function listMemoryDirs(): Promise<string[]> {
  const base = memoryBase();
  const dirs = [join(base, 'global')];
  try {
    for (const name of await readdir(join(base, 'projects'))) {
      dirs.push(join(base, 'projects', name));
    }
  } catch {
    // no project memory yet
  }
  return dirs;
}
