import { z } from 'zod';
import { listProjects, memoryDirByKey } from '../../agent/memory/paths';
import { deleteMemory, listTopics } from '../../agent/memory/store';
import { publicProcedure, router } from '../trpc';

// 'global' or a project dir name; the dir is resolved by memoryDirByKey.
const scope = z.string().min(1);

export const memoryRouter = router({
  /** Projects that have a memory dir — the scope picker lists these next to Global. */
  projects: publicProcedure.query(() => listProjects()),

  /** Stored topics for a scope, each with its raw markdown for inline view. */
  list: publicProcedure
    .input(z.object({ scope }))
    .query(({ input }) => listTopics(memoryDirByKey(input.scope))),

  delete: publicProcedure
    .input(z.object({ scope, name: z.string() }))
    .mutation(async ({ input }) => {
      await deleteMemory(memoryDirByKey(input.scope), input.name);
      return { ok: true };
    }),
});
