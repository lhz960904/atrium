import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { messages, threads } from '../../db/schema';
import { publicProcedure, router } from '../trpc';

export const messagesRouter = router({
  /**
   * Messages in a thread, chronological. Useful when a caller only needs to
   * refetch messages (e.g. after a stream chunk) without re-pulling the
   * thread metadata.
   */
  listByThread: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(messages)
        .where(eq(messages.threadId, input.threadId))
        .orderBy(asc(messages.createdAt))
        .all();
    }),

  /**
   * Append a message. parts / metadata are arbitrary JSON; runtime callers
   * are responsible for shaping them (Vercel AI SDK UIMessage.parts on the
   * agent loop side, the chat-types shapes on the mock side).
   *
   * Also bumps the parent thread's updatedAt so the sidebar floats this
   * thread to the top.
   */
  create: publicProcedure
    .input(
      z.object({
        threadId: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        parts: z.unknown(),
        metadata: z.unknown().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const id = randomUUID();
      ctx.db
        .insert(messages)
        .values({
          id,
          threadId: input.threadId,
          role: input.role,
          parts: input.parts,
          metadata: input.metadata,
        })
        .run();
      ctx.db
        .update(threads)
        .set({ updatedAt: new Date() })
        .where(eq(threads.id, input.threadId))
        .run();
      return { id };
    }),

  /**
   * Delete a set of messages from a thread by id. Used when a user edits an
   * earlier message and re-runs: the edited message and everything after it are
   * dropped so the server rebuilds the correct forked history from the DB (the
   * client sends only the latest message, so the DB is the source of truth).
   * The id set comes from the client's own ordered message list, so truncation
   * is exact — no timestamp comparison that could mis-slice same-millisecond
   * inserts. Scoped to threadId so a stray id can't reach across threads.
   */
  deleteMany: publicProcedure
    .input(z.object({ threadId: z.string(), ids: z.array(z.string()).min(1) }))
    .mutation(({ ctx, input }) => {
      const res = ctx.db
        .delete(messages)
        .where(and(eq(messages.threadId, input.threadId), inArray(messages.id, input.ids)))
        .run();
      return { deleted: res.changes };
    }),
});
