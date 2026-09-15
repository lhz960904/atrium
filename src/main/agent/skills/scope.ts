import type { ToolName } from '@shared/tools';
import type { Capability } from '../runtime/capabilities';
import type { RunContext } from '../runtime/run-context';
import type { AtriumTool } from '../tools';
import { type ActiveSkill, SKILL_SCRATCH_KEY } from './types';

/**
 * Narrow the offered tools to an active skill's allow-list. Always applied to
 * the run's full set rather than to the previous turn's, so a narrowing can
 * never compound: a skill that goes inactive gets every tool back. An
 * allow-list that maps onto none of ours leaves the set open — a skill authored
 * for another tool's vocabulary shouldn't accidentally ban everything.
 */
export function scopeToolsToSkill(
  tools: AtriumTool[],
  active: ActiveSkill | undefined,
): AtriumTool[] {
  if (!active) return tools;
  const scoped = scopeToolsForSkill(active.allowedTools, tools.map((t) => t.name) as ToolName[]);
  if (!scoped) return tools;
  const allowed = new Set<string>(scoped);
  return tools.filter((t) => allowed.has(t.name));
}

/**
 * Foreign-ecosystem tool names that map onto ours but don't normalize to the
 * same token. Skills written for Claude Code / Codex name tools in their own
 * vocabulary (Read, Edit, shell…); these are the ones whose spelling differs
 * enough that normalization alone won't match. Names that only differ by case
 * or separators (WebFetch ↔ web_fetch, Bash ↔ bash) need no entry.
 */
const ALIAS: Record<string, ToolName> = {
  read: 'read_file',
  write: 'write_file',
  edit: 'write_file',
  shell: 'bash',
};

const norm = (s: string): string => s.toLowerCase().replace(/[_-]/g, '');

/** Resolve one declared tool name to one of ours, or null if it maps to none. */
export function resolveToolName(declared: string, available: ToolName[]): ToolName | null {
  const n = norm(declared);
  const direct = available.find((t) => norm(t) === n);
  if (direct) return direct;
  const aliased = ALIAS[n];
  return aliased && available.includes(aliased) ? aliased : null;
}

/**
 * The active-tools whitelist a skill's allowed-tools imposes, or null for
 * "don't constrain". Each declared name is mapped onto our registry (across
 * ecosystem vocabularies) and intersected with what's available. An empty
 * intersection returns null rather than an empty whitelist: a skill authored
 * for another tool's names shouldn't accidentally ban every tool we have.
 */
export function scopeToolsForSkill(
  allowed: string[] | undefined,
  available: ToolName[],
): ToolName[] | null {
  if (!allowed || allowed.length === 0) return null;
  const mapped = new Set<ToolName>();
  for (const name of allowed) {
    const resolved = resolveToolName(name, available);
    if (resolved) mapped.add(resolved);
  }
  return mapped.size > 0 ? [...mapped] : null;
}

/** Recompute from the full catalog so leaving a skill restores tools. Register before hard restrictions. */
export function skillToolScope(tools: AtriumTool[], scratch: RunContext['scratch']): Capability {
  return {
    name: 'skill-tool-scope',
    prepareNextTurn: ({ context }) => ({
      context: {
        ...context,
        tools: scopeToolsToSkill(tools, scratch.get(SKILL_SCRATCH_KEY) as ActiveSkill | undefined),
      },
    }),
  };
}
