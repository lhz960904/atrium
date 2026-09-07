import { homedir } from 'node:os';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { discoverInstructions, type InstructionFile } from '../instructions';
import { MEMORY_INDEX_BUDGET, MEMORY_SCOPES, type MemoryScope, memoryDir } from '../memory/paths';
import { readIndexClipped } from '../memory/store';
import { readUser as readUserProfile } from '../profile/paths';
import type { Skill } from '../skills/types';
import type { ContextTransform } from './context';
import { injectSystemReminder } from './history';

/**
 * The standing context a turn carries beyond the transcript itself: available
 * skills, durable memory, custom instructions, the user's profile. Each is read
 * once per run and rendered as a `<system-reminder>` on the model's view of the
 * first user turn — identical every turn, so it rides inside the cached prefix.
 */

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The progressive-loading index: name + description only, never the body and
 * never the file path. The model reads this to decide which skill fits, then
 * loads its full instructions on demand through the skill tool — addressed by
 * name. The on-disk location is deliberately withheld: exposing it would invite
 * the model to read the manifest directly, bypassing the skill tool and losing
 * the activation signal that the live indicator, tool scoping and compaction
 * rescue all key off.
 */
export function skillsIndexBlock(skills: Skill[]): string | null {
  if (skills.length === 0) return null;
  const entries = skills
    .map((s) => `  <skill name="${escapeXml(s.name)}">${escapeXml(s.description)}</skill>`)
    .join('\n');
  return `You have skills available — saved procedures for specific kinds of tasks. Only each skill's name and short description is shown here, not its instructions.

<available_skills>
${entries}
</available_skills>

When a request matches a skill, load it with the skill tool (by name) and follow the instructions it returns. Load it through the skill tool — don't open the skill file yourself, and don't claim to use a skill you haven't loaded. If none fit, just proceed normally.

When a user message contains a tag like <skill-use>name</skill-use>, the user has explicitly invoked that skill — load it with the skill tool and follow it.`;
}

const INSTRUCTIONS_PREAMBLE =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

export function instructionsBlock(files: InstructionFile[]): string | null {
  if (files.length === 0) return null;
  const blocks = files.map((f) => `Contents of ${f.path}:\n${f.content}`).join('\n\n');
  return `<custom-instructions>\n${INSTRUCTIONS_PREAMBLE}\n\n${blocks}\n</custom-instructions>`;
}

export function memoryBlock(scope: MemoryScope, index: string): string | null {
  if (!index.includes('\n- ')) return null; // header-only / absent → nothing to inject
  return `<memory scope="${scope}">\nDurable ${scope} memory. Read an entry in full with the memory tool (view, scope=${scope}, name=…) before relying on it.\n\n${index}\n</memory>`;
}

export function profileBlock(user: string): string | null {
  if (!user) return null;
  return `<user-profile>\nWhat we know about the user — name, background, preferences. Address and tailor to them accordingly.\n\n${user}\n</user-profile>`;
}

export type ContextBlockSources = {
  skills: Skill[];
  workspaceRoot: string;
  /** Home dir for instruction discovery; injectable for tests. */
  home?: string;
  /** Resolve a scope's memory dir; defaults to the app-data location. */
  resolveMemoryDir?: (scope: MemoryScope, workspaceRoot: string) => string;
  /** Reads USER.md; defaults to the app-data file. */
  readUser?: () => Promise<string>;
};

/**
 * Read every standing block once, in the order they are prepended. Since each
 * lands on top of the last, the model reads them back in reverse: profile,
 * instructions, memory, skills, then what the user actually wrote.
 */
export async function loadContextBlocks(sources: ContextBlockSources): Promise<string[]> {
  const resolveDir = sources.resolveMemoryDir ?? memoryDir;
  const getUser = sources.readUser ?? readUserProfile;

  const blocks: (string | null)[] = [skillsIndexBlock(sources.skills)];
  // Specific first, so the broad (global) block ends up on top after prepending.
  for (const scope of [...MEMORY_SCOPES].reverse()) {
    blocks.push(memoryBlock(scope, await readIndex(scope, sources.workspaceRoot, resolveDir)));
  }
  const files = await discoverInstructions(sources.home ?? homedir(), sources.workspaceRoot);
  blocks.push(instructionsBlock(files));
  blocks.push(profileBlock(await getUser()));

  return blocks.filter((b): b is string => b !== null);
}

// Resolving the dir is inside the try so a missing store — or no electron,
// under tests — degrades to "no memory" rather than failing the turn.
async function readIndex(
  scope: MemoryScope,
  workspaceRoot: string,
  resolveDir: (scope: MemoryScope, workspaceRoot: string) => string,
): Promise<string> {
  try {
    return await readIndexClipped(resolveDir(scope, workspaceRoot), MEMORY_INDEX_BUDGET);
  } catch {
    return '';
  }
}

/**
 * Prepend the loaded blocks to the first user turn. Re-applied on every request
 * rather than written into the transcript, so the blocks always land on whatever
 * the first user message currently is — including one compaction folded into a
 * summary — and never reach what gets stored.
 */
export function injectContextBlocks(blocks: string[]): ContextTransform {
  return (messages: AgentMessage[]) =>
    blocks.reduce((acc, block) => injectSystemReminder(acc, block), messages);
}
