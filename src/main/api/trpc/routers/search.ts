import { searchChats } from '@main/conversation/search';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

export const searchRouter = router({
  /** BM25-ranked threads with a highlighted snippet; an empty query lists the scope. */
  chats: publicProcedure
    .input(z.object({ query: z.string(), scope: z.enum(['active', 'archived']).default('active') }))
    .query(({ ctx, input }) => searchChats(ctx.db, input.query, input.scope)),
});
