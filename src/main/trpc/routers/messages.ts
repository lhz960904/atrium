import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { messages, threads } from '../../db/schema';
import { rewindThread, threadMessages } from '../../session/threads';
import { publicProcedure, router } from '../trpc';

export const messagesRouter = router({
  /**
   * Messages in a thread, chronological. Useful when a caller only needs to
   * refetch messages (e.g. after a stream chunk) without re-pulling the
   * thread metadata.
   */
  listByThread: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .query(({ ctx, input }) => threadMessages(ctx.db, input.threadId)),

  /**
   * Append a message. parts / metadata are arbitrary JSON; runtime callers
   * are responsible for shaping them (UIMessage.parts on the agent loop side,
   * the chat-types shapes on the mock side).
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
   * Take a thread back to just before one message — what editing an earlier
   * message and re-running needs. The client sends the message it is rewriting;
   * the conversation after it stops being part of the branch, so the re-run
   * continues from the right place instead of replaying the stale tail.
   */
  rewind: publicProcedure
    .input(z.object({ threadId: z.string(), messageId: z.string() }))
    .mutation(async ({ ctx, input }) => ({
      rewound: await rewindThread(ctx.db, input.threadId, input.messageId),
    })),
});
