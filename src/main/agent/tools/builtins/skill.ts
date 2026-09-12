import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripFrontmatter } from '@main/utils/frontmatter';
import type { Message, TextContent, ToolResultMessage } from '@shared/protocol';
import type { ContextPreserver } from '../../runtime/compaction';
import type { RunContext } from '../../runtime/run-context';
import { type ActiveSkill, SKILL_FILE, SKILL_SCRATCH_KEY, type Skill } from '../../skills/types';
import { defineTool, Type, textResult } from '../define';

export type SkillToolDeps = {
  /** The discovered skills, resolved by name when the model loads one. */
  skills: Skill[];
  /** The turn's context — activation is recorded in its scratch. */
  run: RunContext;
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
  return defineTool({
    name: 'skill',
    label: 'Load skill',
    description:
      'Load the full instructions for an available skill (listed in the available_skills reminder) so you can carry out its procedure. Call this with the skill name the moment a request matches one, then follow the instructions it returns. Pass any user-supplied specifics as args.',
    parameters: Type.Object({
      name: Type.String({ description: 'The name of the skill to load, exactly as listed.' }),
      args: Type.Optional(
        Type.String({
          description:
            'Optional specifics to hand the skill (e.g. the concrete subject or target).',
        }),
      ),
    }),
    execute: async (_id, { name, args }) => {
      const skill = byName.get(name);
      if (!skill) {
        const names = [...byName.keys()].join(', ') || '(none)';
        throw new Error(`unknown skill '${name}'. Available skills: ${names}.`);
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
        throw new Error(`could not read skill '${name}': ${(err as Error).message}`);
      }

      deps.run.scratch.set(SKILL_SCRATCH_KEY, {
        name: skill.name,
        allowedTools: skill.allowedTools,
      } satisfies ActiveSkill);

      // Prepend the skill's base directory (Claude Code convention) so the body
      // can reference its bundled scripts/templates by relative path.
      const header = `Base directory for this skill: ${skill.dir}`;
      const withArgs = args ? `${body}\n\n---\nArguments for this run: ${args}` : body;
      return textResult(`${header}\n\n${withArgs}`);
    },
  });
};

const SKILL_CARRY = 'Active skill instructions (carry forward — keep following them):';

function carrySkill(inRecent: string | null, inFold: string | null): string | null {
  // Still in the kept window → the model sees it; nothing to carry.
  if (inRecent || !inFold) return null;
  return `${SKILL_CARRY}\n${inFold}`;
}

/** Latest loaded skill body in a slice of the engine's transcript, or null. */
export function latestSkillBody(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'toolResult') continue;
    const result = message as ToolResultMessage;
    if (result.toolName !== 'skill') continue;
    const text = result.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (text) return text;
  }
  return null;
}

export const preserveActiveSkill: ContextPreserver = (fold, recent) =>
  carrySkill(latestSkillBody(recent), latestSkillBody(fold));
