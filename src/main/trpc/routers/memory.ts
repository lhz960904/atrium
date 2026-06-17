import { z } from 'zod';
import { memoryDir } from '../../agent/memory/paths';
import { deleteMemory, listTopics } from '../../agent/memory/store';
import { publicProcedure, router } from '../trpc';

const scope = z.enum(['global', 'project']);

export const memoryRouter = router({
  /** Stored topics for a scope, each with its raw markdown for inline view. */
  list: publicProcedure
    .input(z.object({ scope }))
    .query(({ input, ctx }) => listTopics(memoryDir(input.scope, ctx.workspaceRoot))),

  delete: publicProcedure
    .input(z.object({ scope, name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await deleteMemory(memoryDir(input.scope, ctx.workspaceRoot), input.name);
      return { ok: true };
    }),
});
