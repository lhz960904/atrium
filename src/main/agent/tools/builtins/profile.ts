import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { profileDir, SOUL_FILE, USER_FILE } from '../../profile/paths';
import { defineTool, StringEnum, Type, textResult } from '../define';

const DESCRIPTION = `Read and write the two identity files.
soul = who you are: your name, persona, and how you relate to this user. user = who the user is: their name, background, and preferences.
Use this to establish or refine either identity — during a get-acquainted conversation, or whenever the user asks you to adjust how you act or what you know about them. Write the FULL file each time (it replaces the old one). Keep each concise and in a dense, telegraphic style. The user's name lives in USER.md frontmatter as \`name:\`.`;

export const profileParameters = Type.Object({
  command: StringEnum(['view', 'write']),
  target: StringEnum(['soul', 'user']),
  content: Type.Optional(
    Type.String({
      description: 'the full markdown to write (replaces the file) when command=write',
    }),
  ),
});

type ProfileCommand = { command: 'view' | 'write'; target: 'soul' | 'user'; content?: string };

export async function dispatchProfile(dir: string, cmd: ProfileCommand): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, cmd.target === 'soul' ? SOUL_FILE : USER_FILE);
  if (cmd.command === 'view') {
    let content = '';
    try {
      content = await readFile(path, 'utf8');
    } catch {
      // missing → empty
    }
    return content.trim() || '(empty)';
  }
  if (!cmd.content) throw new Error('write requires content');
  await writeFile(path, cmd.content, 'utf8');
  return `wrote ${cmd.target} profile`;
}

export function profileTool() {
  return defineTool({
    name: 'profile',
    label: 'Profile',
    description: DESCRIPTION,
    parameters: profileParameters,
    execute: async (_id, input) => textResult(await dispatchProfile(profileDir(), input)),
  });
}
