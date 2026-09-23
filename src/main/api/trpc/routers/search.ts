import { searchChats } from '@main/conversation/search';
import { getDb } from '@main/db';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

export const searchRouter = router({
  /** BM25-ranked threads with a highlighted snippet; an empty query lists the scope. */
  chats: publicProcedure
    .input(z.object({ query: z.string(), scope: z.enum(['active', 'archived']).default('active') }))
    .query(({ input }) => searchChats(getDb(), input.query, input.scope)),
});
