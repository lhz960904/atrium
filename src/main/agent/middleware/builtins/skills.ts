import type { ToolName } from '@shared/tools';
import type { UIMessage } from 'ai';
import { scopeToolsForSkill } from '../../skills/scope';
import { type ActiveSkill, SKILL_SCRATCH_KEY, type Skill } from '../../skills/types';
import type { AgentMiddleware, RunContext, StepOverride } from '../types';

export type SkillsOptions = {
  /** The skills discovered at startup (see agent/skills/discover). */
  skills: Skill[];
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The progressive-loading index: name + description only, never the body and
 * never the file path. The model reads this to decide which skill fits, then
 * loads its full instructions on demand through the skill tool — addressed by
 * name. The on-disk location is deliberately withheld: exposing it would invite
 * the model to read the manifest directly, bypassing the skill tool and losing
 * the activation signal that the live indicator, tool scoping and compaction
 * rescue all key off.
 */
function buildIndexReminder(skills: Skill[]): string {
  const entries = skills
    .map((s) => `  <skill name="${escapeXml(s.name)}">${escapeXml(s.description)}</skill>`)
    .join('\n');
  return `<system-reminder>
You have skills available — saved procedures for specific kinds of tasks. Only each skill's name and short description is shown here, not its instructions.

<available_skills>
${entries}
</available_skills>

When a request matches a skill, load it with the skill tool (by name) and follow the instructions it returns. Load it through the skill tool — don't open the skill file yourself, and don't claim to use a skill you haven't loaded. If none fit, just proceed normally.

When a user message contains a tag like <skill-use>name</skill-use>, the user has explicitly invoked that skill — load it with the skill tool and follow it.
</system-reminder>`;
}

/**
 * Inject the available-skills index into the first user message as a
 * system-reminder. Kept out of the system prompt on purpose: the index is
 * filesystem-derived and changes between sessions, so it belongs in the
 * volatile-context region (alongside date/memory), not in the largest, most
 * cacheable block. Placing it after the system prompt keeps that block's prefix
 * cache intact when the skill set changes.
 *
 * Injection is non-destructive — it clones the target message and rebuilds the
 * array rather than mutating parts in place, so the reminder never leaks into
 * the original messages the UI and DB render from.
 *
 * Must run after compaction in the chain: compaction can fold the original
 * first user message into a summary, and the index has to land on whatever the
 * post-compaction first user message is.
 */
export function skillsMiddleware(options: SkillsOptions): AgentMiddleware {
  const { skills } = options;
  return {
    name: 'skills',
    beforeRun(ctx: RunContext): void {
      if (skills.length === 0) return;
      const msgs = ctx.request.messages;
      const idx = msgs.findIndex((m) => m.role === 'user');
      if (idx < 0) return;

      const target = msgs[idx];
      const injected: UIMessage = {
        ...target,
        parts: [{ type: 'text', text: buildIndexReminder(skills) }, ...target.parts],
      };
      ctx.request.messages = [...msgs.slice(0, idx), injected, ...msgs.slice(idx + 1)];
    },

    // Once a skill is loaded (the skill tool records it in scratch), scope the
    // following steps' tools to that skill's allowed-tools. Resolves on the
    // active registry; an unconstrainable allow-list (nothing maps) leaves
    // tools open rather than banning everything. Fires from the step after the
    // load — the loading step itself isn't scoped.
    beforeStep(ctx: RunContext): StepOverride | undefined {
      const active = ctx.scratch.get(SKILL_SCRATCH_KEY) as ActiveSkill | undefined;
      if (!active) return undefined;
      const available = Object.keys(ctx.request.tools) as ToolName[];
      const scoped = scopeToolsForSkill(active.allowedTools, available);
      return scoped ? { activeTools: scoped } : undefined;
    },
  };
}
