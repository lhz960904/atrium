import { analyzeBash, type Crossing, describeWriteEscape } from '@shared/permissions/analyze';
import type { ToolName } from '@shared/tools';
import { resolveInWorkspace } from '../sandbox/paths';

export type Classification = { crosses: false } | ({ crosses: true } & Crossing);

const INSIDE: Classification = { crosses: false };

/**
 * Decide whether a tool call crosses the workspace boundary — the unit the
 * permission gate prompts on. Boundary = ① writing a file outside the
 * workspace ② a shell command that reaches the network ③ a destructive shell
 * command. Read tools and in-workspace writes stay inside. The command and
 * path analysis lives in @shared/permissions so the renderer's approval card
 * derives the same reason; here we add the one piece that needs the host: the
 * workspace path check.
 */
export function classifyToolCall(
  tool: ToolName,
  input: unknown,
  workspaceRoot: string,
): Classification {
  switch (tool) {
    case 'bash': {
      const command = stringField(input, 'command');
      const crossing = command ? analyzeBash(command) : null;
      return crossing ? { crosses: true, ...crossing } : INSIDE;
    }
    case 'write_file':
    case 'edit_file': {
      const path = stringField(input, 'path');
      // e.g. ../secret.txt , /etc/hosts → flag; src/a.ts , /work/space/src/a.ts → inside
      if (path && escapesWorkspace(workspaceRoot, path)) {
        return { crosses: true, ...describeWriteEscape(path) };
      }
      return INSIDE;
    }
    default:
      // read_file / grep / web_fetch / web_search — never cross, allow
      return INSIDE;
  }
}

function escapesWorkspace(root: string, path: string): boolean {
  try {
    resolveInWorkspace(root, path);
    return false;
  } catch {
    return true;
  }
}

function stringField(input: unknown, key: string): string | null {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return null;
}
