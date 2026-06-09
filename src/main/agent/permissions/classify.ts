import type { ToolName } from '@shared/tools';
import { resolveInWorkspace } from '../sandbox/paths';
import { commandName, splitSubcommands, subcommand } from './command';
import { isDangerous, isWrapper, NETWORK_COMMANDS, NETWORK_SUBCOMMANDS } from './lists';

export type BoundaryKind = 'fs-escape' | 'network' | 'dangerous' | 'opaque';

export type Classification =
  | { crosses: false }
  | { crosses: true; kind: BoundaryKind; reason: string };

const INSIDE: Classification = { crosses: false };

/**
 * Decide whether a tool call crosses the workspace boundary — the unit the
 * permission gate prompts on. Boundary = ① writing a file outside the
 * workspace ② a shell command that reaches the network ③ a destructive shell
 * command. Read tools and in-workspace writes stay inside.
 *
 * Without an OS sandbox the bash analysis is a heuristic, not a security
 * boundary: it errs toward "ask" when it can't read the command (substitution,
 * wrappers), and the Auto-review reviewer covers what the lists miss.
 */
export function classifyToolCall(
  tool: ToolName,
  input: unknown,
  workspaceRoot: string,
): Classification {
  switch (tool) {
    case 'bash':
      return classifyBash(input);
    case 'write_file':
    case 'edit_file':
      return classifyWrite(input, workspaceRoot);
    default:
      return INSIDE;
  }
}

function classifyWrite(input: unknown, workspaceRoot: string): Classification {
  const path = stringField(input, 'path');
  if (!path) return INSIDE;
  if (escapesWorkspace(workspaceRoot, path)) {
    return { crosses: true, kind: 'fs-escape', reason: `写入 workspace 外的路径：${path}` };
  }
  return INSIDE;
}

function classifyBash(input: unknown): Classification {
  const command = stringField(input, 'command')?.trim();
  if (!command) return INSIDE;

  // Command substitution runs a hidden inner command we can't read statically.
  if (/`|\$\(/.test(command)) {
    return { crosses: true, kind: 'opaque', reason: '命令含替换（$() 或反引号），无法静态判定' };
  }

  const segments = splitSubcommands(command);
  if (!segments) {
    return { crosses: true, kind: 'opaque', reason: '命令无法解析，保险起见需确认' };
  }

  for (const tokens of segments) {
    const name = commandName(tokens);
    if (!name) continue;
    if (isDangerous(name)) return { crosses: true, kind: 'dangerous', reason: `危险命令：${name}` };
    if (isWrapper(name)) {
      return { crosses: true, kind: 'opaque', reason: `包装执行（${name}），无法静态判定真实命令` };
    }
    if (NETWORK_COMMANDS.has(name)) {
      return { crosses: true, kind: 'network', reason: `联网命令：${name}` };
    }
    const sub = subcommand(tokens);
    if (sub && NETWORK_SUBCOMMANDS[name]?.has(sub)) {
      return { crosses: true, kind: 'network', reason: `联网命令：${name} ${sub}` };
    }
  }
  return INSIDE;
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
