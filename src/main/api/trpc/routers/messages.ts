import { rewindThread, threadMessages } from '@main/conversation/threads';
import { z } from 'zod';
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
