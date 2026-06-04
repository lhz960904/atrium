import { getSkills } from '../../agent/skills/registry';
import { publicProcedure, router } from '../trpc';

export const skillsRouter = router({
  /** Skills discovered at startup, for the slash menu and the read-only list. */
  list: publicProcedure.query(() =>
    getSkills().map((s) => ({ name: s.name, description: s.description, source: s.source })),
  ),
});
