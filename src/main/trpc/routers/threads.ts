import { randomUUID } from 'node:crypto';
import { asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { messages, projects, threads } from '../../db/schema';
import { getRunningThreadIds } from '../../server/resumable';
import { publicProcedure, router } from '../trpc';

/** A thread's bound model; null = inherit general.defaultModel. */
const modelInput = z.object({ providerId: z.string(), modelId: z.string() }).nullable();

export const threadsRouter = router({
  /** Active (non-archived) threads, most-recently-updated first. */
  list: publicProcedure.query(({ ctx }) => {
    return ctx.db
      .select()
      .from(threads)
      .where(isNull(threads.archivedAt))
      .orderBy(desc(threads.updatedAt))
      .all();
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
          model: modelInput.optional(),
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
          modelProviderId: input?.model?.providerId ?? null,
          modelId: input?.model?.modelId ?? null,
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

  /**
   * Rename a thread; bumps updatedAt so it floats to the top of the sidebar.
   * Advance lastReadAt in lockstep — a rename is a deliberate edit by someone
   * viewing the thread, so it must not trip the unread dot the way new activity
   * does (which bumps updatedAt past lastReadAt).
   */
  updateTitle: publicProcedure
    .input(z.object({ id: z.string(), title: z.string() }))
    .mutation(({ ctx, input }) => {
      const now = new Date();
      ctx.db
        .update(threads)
        .set({ title: input.title, updatedAt: now, lastReadAt: now })
        .where(eq(threads.id, input.id))
        .run();
    }),

  /** Bind (or clear) this thread's model; null = inherit general.defaultModel.
   *  Doesn't touch updatedAt — picking a model isn't thread activity. */
  setModel: publicProcedure
    .input(z.object({ id: z.string(), model: modelInput }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(threads)
        .set({
          modelProviderId: input.model?.providerId ?? null,
          modelId: input.model?.modelId ?? null,
        })
        .where(eq(threads.id, input.id))
        .run();
    }),

  /** Archive a thread — drops it from the sidebar list without deleting it. */
  archive: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.update(threads).set({ archivedAt: new Date() }).where(eq(threads.id, input.id)).run();
  }),

  /**
   * Restore an archived thread back into the sidebar list. If its project was
   * archived too, revive the project — otherwise the thread would point at a
   * hidden project and never show up.
   */
  unarchive: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const thread = ctx.db
      .select({ projectId: threads.projectId })
      .from(threads)
      .where(eq(threads.id, input.id))
      .get();
    ctx.db.update(threads).set({ archivedAt: null }).where(eq(threads.id, input.id)).run();
    if (thread?.projectId) {
      ctx.db
        .update(projects)
        .set({ archivedAt: null })
        .where(eq(projects.id, thread.projectId))
        .run();
    }
  }),

  /** Pin / unpin to the sidebar's Pinned section; doesn't reorder by recency. */
  pin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.update(threads).set({ pinned: true }).where(eq(threads.id, input.id)).run();
  }),

  unpin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.update(threads).set({ pinned: false }).where(eq(threads.id, input.id)).run();
  }),
});
