import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripFrontmatter } from '../../agent/skills/discover';
import { getSkills } from '../../agent/skills/registry';
import { SKILL_FILE } from '../../agent/skills/types';
import { publicProcedure, router } from '../trpc';

export const skillsRouter = router({
  /** Lean list (name/description/source) for the composer's slash menu. */
  list: publicProcedure.query(() =>
    getSkills().map((s) => ({ name: s.name, description: s.description, source: s.source })),
  ),

  /**
   * Every skill plus its manifest body (frontmatter stripped), read in one shot
   * for the settings viewer — local files, so loading all up front keeps the
   * row expansion instant instead of a per-row round-trip.
   */
  all: publicProcedure.query(() =>
    Promise.all(
      getSkills().map(async (s) => {
        let body = '';
        try {
          body = stripFrontmatter(await readFile(join(s.dir, SKILL_FILE), 'utf8'));
        } catch {
          // unreadable manifest — leave empty; the viewer shows a no-content note
        }
        return { name: s.name, description: s.description, source: s.source, body };
      }),
    ),
  ),
});
