import { runner } from '@main/agent/runtime/current-runner';
import { conversationStore } from '@main/conversation/store/conversation';
import { threadStore } from '@main/conversation/store/threads';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

/** A thread's bound model; null = inherit general.defaultModel. */
const modelInput = z.object({ providerId: z.string(), modelId: z.string() }).nullable();

const byId = z.object({ id: z.string() });

export const threadsRouter = router({
  /** Active (non-archived) threads, most-recently-updated first. */
  list: publicProcedure.query(() => threadStore().list()),

  /** Thread ids whose agent is currently generating — the source of truth lives
   *  in the main process, so the sidebar spinner stays correct across reloads. */
  running: publicProcedure.query(() => runner().runningThreadIds()),

  /** One thread plus its conversation, or null when there is no such thread. */
  get: publicProcedure.input(byId).query(async ({ input }) => {
    const thread = threadStore().get(input.id);
    if (!thread) return null;
    return { ...thread, messages: await conversationStore().getUIMessagesByThreadID(input.id) };
  }),

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
    .mutation(({ input }) => ({ id: threadStore().create(input ?? {}) })),

  /** The conversation is kept — see ThreadStore.remove. */
  delete: publicProcedure.input(byId).mutation(({ input }) => threadStore().remove(input.id)),

  markRead: publicProcedure.input(byId).mutation(({ input }) => threadStore().markRead(input.id)),

  updateTitle: publicProcedure
    .input(z.object({ id: z.string(), title: z.string() }))
    .mutation(({ input }) => threadStore().rename(input.id, input.title)),

  setModel: publicProcedure
    .input(z.object({ id: z.string(), model: modelInput }))
    .mutation(({ input }) => threadStore().setModel(input.id, input.model)),

  archive: publicProcedure.input(byId).mutation(({ input }) => threadStore().archive(input.id)),

  unarchive: publicProcedure.input(byId).mutation(({ input }) => threadStore().unarchive(input.id)),

  pin: publicProcedure.input(byId).mutation(({ input }) => threadStore().pin(input.id, true)),

  unpin: publicProcedure.input(byId).mutation(({ input }) => threadStore().pin(input.id, false)),
});
