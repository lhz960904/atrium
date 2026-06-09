import { parse } from 'shell-quote';

/**
 * Split a shell command into its sub-commands (the segments between control
 * operators &&, ||, |, ;, &), each as a token list. Returns null when the
 * command can't be parsed — callers treat that as "can't read it, ask". Only
 * structure is recovered here; danger/network policy lives in classify.
 */
const CONTROL_OPS = new Set([';', '&&', '||', '|', '|&', '&', '\n']);

export function splitSubcommands(command: string): string[][] | null {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(command);
  } catch {
    return null;
  }

  const segments: string[][] = [];
  let current: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      current.push(entry);
      continue;
    }
    if (entry && typeof entry === 'object' && 'op' in entry) {
      if (CONTROL_OPS.has(entry.op)) {
        if (current.length) segments.push(current);
        current = [];
      } else if (entry.op === 'glob') {
        current.push(entry.pattern);
      }
      // redirections (>, <, >>, …) and other ops aren't part of a command
      // name — skip the operator token, keep scanning the segment.
    }
    // comments and anything else: ignore
  }
  if (current.length) segments.push(current);
  return segments;
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Tokens with leading `VAR=value` env assignments stripped. */
function effective(tokens: string[]): string[] {
  let i = 0;
  for (const t of tokens) {
    if (!ENV_ASSIGN.test(t)) break;
    i++;
  }
  return tokens.slice(i);
}

/** The command name of a sub-command — basename, env prefix stripped. */
export function commandName(tokens: string[]): string | null {
  const first = effective(tokens)[0];
  if (!first) return null;
  const slash = first.lastIndexOf('/');
  return slash >= 0 ? first.slice(slash + 1) : first;
}

/** The first argument after the command name (its subcommand, if any). */
export function subcommand(tokens: string[]): string | null {
  return effective(tokens)[1] ?? null;
}
