import type { ToolName } from '@shared/tools';
import { scopeToolsForSkill } from '../skills/scope';
import type { ActiveSkill } from '../skills/types';
import type { AtriumTool } from '../tools';

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
