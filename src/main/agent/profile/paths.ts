import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from '../../shared/frontmatter';

export const SOUL_FILE = 'SOUL.md';
export const USER_FILE = 'USER.md';

// Lazy require: electron only exists in the app runtime (keeps this loadable under bun).
export function profileDir(): string {
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'profile');
}

export async function readSoul(): Promise<string> {
  return readProfileFile(SOUL_FILE);
}
export async function readUser(): Promise<string> {
  return readProfileFile(USER_FILE);
}

/** The name to greet the user by, from USER.md's frontmatter; null if unset. */
export function parseDisplayName(userMd: string): string | null {
  const name = parseFrontmatter(userMd)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// Resolving profileDir is inside the try so a missing file — or no electron,
// under tests — both degrade to "no profile" rather than throwing.
async function readProfileFile(file: string): Promise<string> {
  try {
    return (await readFile(join(profileDir(), file), 'utf8')).trim();
  } catch {
    return '';
  }
}
