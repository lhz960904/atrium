import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../log';
import { discoverSkills } from './discover';
import type { Skill, SkillRoots } from './types';

/**
 * Process-wide skill registry, warmed once at startup like the model catalog —
 * read directly (getSkills) by the tool registry, the skills middleware, and
 * the tRPC layer rather than threaded through each. Scans the bundled built-in
 * skills plus the three on-disk ecosystem homes. Re-runnable for a future refresh.
 */
const log = createLogger('skills');

let cache: Skill[] = [];

// Bundled skills ship beside the app (mirrors the drizzle-migrations resolver):
// process.resourcesPath when packaged, the repo root in dev. Lazy require keeps
// this module loadable under bun.
function builtinSkillsRoot(): string {
  const { app } = require('electron') as typeof import('electron');
  return app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'skills');
}

function defaultRoots(): SkillRoots {
  const home = homedir();
  return {
    builtin: builtinSkillsRoot(),
    agents: join(home, '.agents', 'skills'),
    claude: join(home, '.claude', 'skills'),
    codex: join(home, '.codex', 'skills'),
  };
}

/** Discover skills from the standard roots and cache them for the process. */
export async function refreshSkills(roots: SkillRoots = defaultRoots()): Promise<Skill[]> {
  cache = await discoverSkills(roots);
  log.info(`skill registry: ${cache.length} skill(s) available`);
  return cache;
}

/** The skills discovered at startup; empty until refreshSkills has run. */
export function getSkills(): Skill[] {
  return cache;
}
