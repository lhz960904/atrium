import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ModelMessage, tool, type UIMessage } from 'ai';
import { z } from 'zod';
import type { CompactionPreserver } from '../../compaction/preserver';
import type { RunContext } from '../../middleware';
import { stripFrontmatter } from '../../skills/discover';
import { type ActiveSkill, SKILL_FILE, SKILL_SCRATCH_KEY, type Skill } from '../../skills/types';

export type SkillToolDeps = {
  /** The discovered skills, resolved by name when the model loads one. */
  skills: Skill[];
};

/**
 * Load a skill's full instructions on demand. The available skills are
 * advertised (name + description only) in the turn's system-reminder; this tool
 * is how the model pulls the body of one it decides to use. Loading flows
 * through this tool — not a raw file read — so activation produces a clean
 * signal: it records the active skill in scratch, which scopes the following
 * steps' tools to the skill's allowed-tools. The body it returns becomes the
 * tool result the model then follows; the call itself shows in the trace.
 */
export const skillTool = (deps: SkillToolDeps) => {
  const byName = new Map(deps.skills.map((s) => [s.name, s]));
  return tool({
    description:
      'Load the full instructions for an available skill (listed in the available_skills reminder) so you can carry out its procedure. Call this with the skill name the moment a request matches one, then follow the instructions it returns. Pass any user-supplied specifics as args.',
    inputSchema: z.object({
      name: z.string().describe('The name of the skill to load, exactly as listed.'),
      args: z
        .string()
        .optional()
        .describe('Optional specifics to hand the skill (e.g. the concrete subject or target).'),
    }),
    execute: async ({ name, args }, { experimental_context }) => {
      const ctx = experimental_context as RunContext;
      const skill = byName.get(name);
      if (!skill) {
        const names = [...byName.keys()].join(', ') || '(none)';
        return `Error: unknown skill '${name}'. Available skills: ${names}.`;
      }

      let body: string;
      try {
        const raw = await readFile(join(skill.dir, SKILL_FILE), 'utf8');
        // Honor an explicit $SKILL_DIR placeholder for skills that hardcode it
        // (both the shell and braced spellings show up in the wild).
        body = stripFrontmatter(raw)
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder we substitute
          .replaceAll('${SKILL_DIR}', skill.dir)
          .replaceAll('$SKILL_DIR', skill.dir);
      } catch (err) {
        return `Error: could not read skill '${name}': ${(err as Error).message}`;
      }

      ctx.scratch.set(SKILL_SCRATCH_KEY, {
        name: skill.name,
        allowedTools: skill.allowedTools,
      } satisfies ActiveSkill);

      // Prepend the skill's base directory (Claude Code convention) so the body
      // can reference its bundled scripts/templates by relative path.
      const header = `Base directory for this skill: ${skill.dir}`;
      const withArgs = args ? `${body}\n\n---\nArguments for this run: ${args}` : body;
      return `${header}\n\n${withArgs}`;
    },
  });
};

/** Latest loaded skill body in a UIMessage slice (cross-turn), or null. */
export function latestSkillBodyUI(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j] as { type?: string; state?: string; output?: unknown };
      if (
        p.type === 'tool-skill' &&
        p.state === 'output-available' &&
        typeof p.output === 'string'
      ) {
        return p.output;
      }
    }
  }
  return null;
}

function resultText(output: unknown): string | null {
  if (typeof output === 'string') return output;
  const o = output as { type?: string; value?: unknown };
  return o?.type === 'text' && typeof o.value === 'string' ? o.value : null;
}

/** Latest loaded skill body in a ModelMessage slice (within-turn), or null. */
export function latestSkillBodyModel(messages: ModelMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const p = content[j] as { type?: string; toolName?: string; output?: unknown };
      if (p.type === 'tool-result' && p.toolName === 'skill') {
        const text = resultText(p.output);
        if (text) return text;
      }
    }
  }
  return null;
}

const SKILL_CARRY = 'Active skill instructions (carry forward — keep following them):';

function carrySkill(inRecent: string | null, inFold: string | null): string | null {
  // Still in the kept window → the model sees it; nothing to carry.
  if (inRecent || !inFold) return null;
  return `${SKILL_CARRY}\n${inFold}`;
}

/**
 * Rescues the most-recently-loaded skill's body across a compaction fold, so the
 * model keeps the SOP it's executing instead of having it summarized away. Only
 * the latest load is carried (one active skill), bounding the carried text.
 */
export const skillPreserver: CompactionPreserver = {
  fromUI: (fold, recent) => carrySkill(latestSkillBodyUI(recent), latestSkillBodyUI(fold)),
  fromModel: (fold, recent) => carrySkill(latestSkillBodyModel(recent), latestSkillBodyModel(fold)),
};
