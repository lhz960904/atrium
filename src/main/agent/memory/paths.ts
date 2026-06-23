import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type MemoryScope = 'global' | 'project';

export const MEMORY_INDEX = 'MEMORY.md';
export const MEMORY_SCOPES: MemoryScope[] = ['global', 'project']; // broad → specific
export const MEMORY_INDEX_BUDGET = 25 * 1024; // injected index byte budget, per scope

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

export type ProjectScope = { key: string; name: string };

// The encoded key joined the path with '-', so the trailing segment is roughly the
// workspace folder name. Lossy when the folder name itself contains '-', but good
// enough for a settings label until we persist the real path alongside the memory.
export function projectName(key: string): string {
  return key.split('-').filter(Boolean).pop() || key;
}

export function mapProjects(dirNames: string[]): ProjectScope[] {
  return dirNames
    .filter((n) => !n.startsWith('.'))
    .map((key) => ({ key, name: projectName(key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Resolve a scope key to its memory dir. 'global' is special; any other key is a
// project dir name. The key comes from listProjects (server-made), but strip path
// separators anyway so a stray value can never escape the projects root.
export function memoryDirByKey(key: string): string {
  if (key === 'global') return join(memoryBase(), 'global');
  return join(memoryBase(), 'projects', key.replace(/[/\\]|\.\./g, ''));
}

/** Every project that has a memory dir, labelled for the settings scope picker. */
export async function listProjects(): Promise<ProjectScope[]> {
  try {
    const ents = await readdir(join(memoryBase(), 'projects'), { withFileTypes: true });
    return mapProjects(ents.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    return [];
  }
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
