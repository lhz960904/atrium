import { join } from 'node:path';

export type MemoryScope = 'global' | 'project';

export const MEMORY_INDEX = 'MEMORY.md';

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
