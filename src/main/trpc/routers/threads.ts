import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { messages, threads } from '../../db/schema';
import { getRunningThreadIds } from '../../server/resumable';
import { publicProcedure, router } from '../trpc';

export const threadsRouter = router({
  /** All threads, most-recently-updated first. */
  list: publicProcedure.query(({ ctx }) => {
    return ctx.db.select().from(threads).orderBy(desc(threads.updatedAt)).all();
  }),

  /** Thread ids whose agent is currently generating — the source of truth lives
   *  in the main process, so the sidebar spinner stays correct across reloads. */
  running: publicProcedure.query(() => getRunningThreadIds()),

  /** One thread + its messages ordered chronologically. Returns null if not found. */
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const thread = ctx.db.select().from(threads).where(eq(threads.id, input.id)).get();
    if (!thread) return null;
    const msgs = ctx.db
      .select()
      .from(messages)
      .where(eq(messages.threadId, input.id))
      .orderBy(asc(messages.createdAt))
      .all();
    return { ...thread, messages: msgs };
  }),

  /** Create an empty thread. Returns the new id. */
  create: publicProcedure
    .input(
      z
        .object({
          title: z.string().optional(),
          projectId: z.string().optional(),
        })
        .optional(),
    )
    .mutation(({ ctx, input }) => {
      const id = randomUUID();
      ctx.db
        .insert(threads)
        .values({
          id,
          title: input?.title ?? null,
          projectId: input?.projectId ?? null,
        })
        .run();
      return { id };
    }),

  /**
   * Atomically create a thread + its first message. Used by the home composer
   * so we never leave empty threads behind when the message insert fails.
   */
  createWithFirstMessage: publicProcedure
    .input(
      z.object({
        title: z.string().optional(),
        projectId: z.string().optional(),
        message: z.object({
          role: z.enum(['user', 'assistant', 'system']),
          parts: z.unknown(),
          metadata: z.unknown().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) => {
      const threadId = randomUUID();
      const messageId = randomUUID();
      ctx.db.transaction((tx) => {
        tx.insert(threads)
          .values({
            id: threadId,
            title: input.title ?? null,
            projectId: input.projectId ?? null,
          })
          .run();
        tx.insert(messages)
          .values({
            id: messageId,
            threadId,
            role: input.message.role,
            parts: input.message.parts,
            metadata: input.message.metadata,
          })
          .run();
      });
      return { threadId, messageId };
    }),

  /** Delete a thread; messages / artifacts cascade. */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.delete(threads).where(eq(threads.id, input.id)).run();
  }),

  /** Mark a thread read up to now, clearing its sidebar unread dot. */
  markRead: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.update(threads).set({ lastReadAt: new Date() }).where(eq(threads.id, input.id)).run();
  }),

  /** Rename a thread; also bumps updatedAt so it floats to the top of the sidebar. */
  updateTitle: publicProcedure
    .input(z.object({ id: z.string(), title: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(threads)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(threads.id, input.id))
        .run();
    }),
});
