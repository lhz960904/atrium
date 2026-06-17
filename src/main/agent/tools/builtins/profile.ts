import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { profileDir, SOUL_FILE, USER_FILE } from '../../profile/paths';

const DESCRIPTION = `Read and write the two identity files.
soul = who you are: your name, persona, and how you relate to this user. user = who the user is: their name, background, and preferences.
Use this to establish or refine either identity — during a get-acquainted conversation, or whenever the user asks you to adjust how you act or what you know about them. Write the FULL file each time (it replaces the old one). Keep each concise and in a dense, telegraphic style. The user's name lives in USER.md frontmatter as \`name:\`.`;

export const profileInputSchema = z.object({
  command: z.enum(['view', 'write']),
  target: z.enum(['soul', 'user']),
  content: z
    .string()
    .optional()
    .describe('the full markdown to write (replaces the file) when command=write'),
});

type ProfileCommand = { command: 'view' | 'write'; target: 'soul' | 'user'; content?: string };

// An empty/missing read nudges the model to run onboarding rather than report a blank.
const guidance = (target: 'soul' | 'user'): string =>
  `No ${target} profile is set yet. Load the "get-acquainted" skill with the skill tool and run that short conversation once — it writes both the user's profile and your persona.`;

export async function dispatchProfile(dir: string, cmd: ProfileCommand): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, cmd.target === 'soul' ? SOUL_FILE : USER_FILE);
  if (cmd.command === 'view') {
    let content = '';
    try {
      content = await readFile(path, 'utf8');
    } catch {
      // missing → fall through to the guidance
    }
    return content.trim() || guidance(cmd.target);
  }
  if (!cmd.content) throw new Error('write requires content');
  await writeFile(path, cmd.content, 'utf8');
  return `wrote ${cmd.target} profile`;
}

export function profileTool() {
  return tool({
    description: DESCRIPTION,
    inputSchema: profileInputSchema,
    execute: (input) => dispatchProfile(profileDir(), input),
  });
}
