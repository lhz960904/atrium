import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
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
});
