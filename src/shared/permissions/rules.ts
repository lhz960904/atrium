import { commandName, splitSubcommands, subcommand } from './command';
import { isDangerous, isWrapper, NETWORK_COMMANDS, NETWORK_SUBCOMMANDS } from './lists';

/**
 * A remembered "always allow" entry. `matcher` is a bash command prefix
 * (`curl`, `npm install`, `rm`) for bash, or an exact path for write/edit.
 * The trust list grows as the user picks "always allow" on an approval; a later
 * call the list covers skips the gate. Must agree with the gate's crossing
 * detection (same command lists), so it lives beside it in shared.
 */
export type TrustRule = { tool: string; matcher: string };

/**
 * The crossing subjects of a bash command — the command identities that make it
 * cross, one per crossing segment. `hasOpaque` marks a segment we can't reduce
 * to a subject (substitution, a wrapper hiding the real command, unparseable),
 * so it can never be covered by a prefix rule.
 */
function bashSubjects(command: string): { subjects: string[]; hasOpaque: boolean } {
  const cmd = command.trim();
  if (!cmd) return { subjects: [], hasOpaque: false };
  if (/`|\$\(/.test(cmd)) return { subjects: [], hasOpaque: true };
  const segments = splitSubcommands(cmd);
  if (!segments) return { subjects: [], hasOpaque: true };

  const subjects: string[] = [];
  let hasOpaque = false;
  for (const tokens of segments) {
    const name = commandName(tokens);
    if (!name) continue;
    if (isDangerous(name)) {
      subjects.push(name);
    } else if (isWrapper(name)) {
      hasOpaque = true;
    } else if (NETWORK_COMMANDS.has(name)) {
      subjects.push(name);
    } else {
      const sub = subcommand(tokens);
      if (sub && NETWORK_SUBCOMMANDS[name]?.has(sub)) subjects.push(`${name} ${sub}`);
    }
  }
  return { subjects, hasOpaque };
}

function field(input: unknown, key: string): string | null {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return null;
}

const isFileTool = (tool: string): boolean => tool === 'write_file' || tool === 'edit_file';

/**
 * The rule "always allow" would create for this call, or null when it can't reduce
 * to one — an opaque command, or a compound crossing several distinct ways.
 * Those only get "allow once".
 */
export function deriveRule(tool: string, input: unknown): TrustRule | null {
  if (tool === 'bash') {
    const command = field(input, 'command');
    if (!command) return null;
    const { subjects, hasOpaque } = bashSubjects(command);
    const unique = [...new Set(subjects)];
    const matcher = unique[0];
    if (hasOpaque || unique.length !== 1 || matcher === undefined) return null;
    return { tool, matcher };
  }
  if (isFileTool(tool)) {
    const path = field(input, 'path');
    return path ? { tool, matcher: path } : null;
  }
  return null;
}

/** Whether the trust list already covers this call (so the gate can skip it). */
export function isAllowed(rules: TrustRule[], tool: string, input: unknown): boolean {
  if (tool === 'bash') {
    const command = field(input, 'command');
    if (!command) return false;
    const { subjects, hasOpaque } = bashSubjects(command);
    if (hasOpaque || subjects.length === 0) return false;
    const allowed = new Set(rules.filter((r) => r.tool === 'bash').map((r) => r.matcher));
    return subjects.every((s) => allowed.has(s));
  }
  if (isFileTool(tool)) {
    const path = field(input, 'path');
    if (!path) return false;
    // A file path the user trusted applies whether it's written or edited.
    return rules.some((r) => isFileTool(r.tool) && r.matcher === path);
  }
  return false;
}
