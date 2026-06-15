import { readFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { createLogger } from '../../log';
import {
  INSTRUCTION_MAX_BYTES,
  type InstructionFile,
  type InstructionKind,
  type InstructionScope,
  KIND_BY_PRIORITY,
} from './types';

const log = createLogger('instructions');

async function readTrimmed(path: string): Promise<string | null> {
  try {
    const content = (await readFile(path, 'utf8')).trim();
    return content || null;
  } catch {
    return null;
  }
}

// Filesystem root → workspace, so the chain reads general→specific.
function ancestorChain(workspaceRoot: string): string[] {
  const root = parse(workspaceRoot).root;
  const dirs: string[] = [];
  for (let cur = workspaceRoot; ; cur = dirname(cur)) {
    dirs.push(cur);
    if (cur === root) break;
  }
  return dirs.reverse();
}

async function pickInDir(dir: string, scope: InstructionScope): Promise<InstructionFile | null> {
  for (const { file, kind } of KIND_BY_PRIORITY) {
    const content = await readTrimmed(join(dir, file));
    if (content) return { path: join(dir, file), kind, scope, content };
  }
  return null;
}

function globalFiles(home: string): { path: string; kind: InstructionKind }[] {
  return [
    { path: join(home, '.codex', 'AGENTS.md'), kind: 'agents' },
    { path: join(home, '.claude', 'CLAUDE.md'), kind: 'claude' },
    { path: join(home, '.agents', 'AGENTS.md'), kind: 'agents' },
  ];
}

/**
 * Global homes, then every directory from the filesystem root down to the workspace,
 * one file each, general→specific. Budget is charged specific-first so an overflow
 * drops the broadest files, never the project's own.
 */
export async function discoverInstructions(
  home: string,
  workspaceRoot: string,
  budget = INSTRUCTION_MAX_BYTES,
): Promise<InstructionFile[]> {
  const collected: InstructionFile[] = [];

  for (const g of globalFiles(home)) {
    const content = await readTrimmed(g.path);
    if (content) collected.push({ path: g.path, kind: g.kind, scope: 'global', content });
  }
  for (const dir of ancestorChain(workspaceRoot)) {
    const file = await pickInDir(dir, 'project');
    if (file) collected.push(file);
  }

  return clipByBudget(collected, budget);
}

function clipByBudget(files: InstructionFile[], budget: number): InstructionFile[] {
  const kept: InstructionFile[] = [];
  let spent = 0;
  for (let i = files.length - 1; i >= 0; i--) {
    const remaining = budget - spent;
    if (remaining <= 0) {
      log.warn(`instructions budget exhausted; dropping ${files[i].path}`);
      continue;
    }
    const content = clipToBytes(files[i].content, remaining);
    spent += Buffer.byteLength(content, 'utf8');
    kept.push({ ...files[i], content });
  }
  return kept.reverse();
}

function clipToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString('utf8')}\n…[truncated]`;
}
