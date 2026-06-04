import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../log';
import { discoverSkills } from './discover';
import type { Skill, SkillRoots } from './types';

/**
 * Process-wide skill registry, warmed once at startup like the model catalog —
 * read directly (getSkills) by the tool registry, the skills middleware, and
 * the tRPC layer rather than threaded through each. V1 scans the three on-disk
 * ecosystem homes; built-in (bundled) skills aren't shipped, so that root is
 * left out. Re-runnable for a future refresh.
 */
const log = createLogger('skills');

let cache: Skill[] = [];

function defaultRoots(): SkillRoots {
  const home = homedir();
  return {
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
