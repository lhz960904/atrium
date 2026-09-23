import {
  InteractionConflict,
  InvalidInteractionDecision,
} from '@main/agent/runtime/pending-interactions';
import type { Runner } from '@main/agent/runtime/runner';
import type { AtriumUIMessage } from '@shared/chat';
import { decideInteractionSchema } from '@shared/interactions';
import { PERMISSION_MODES } from '@shared/permissions';
import type { EventEnvelope } from '@shared/protocol';
import { TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import { badRequest, conflict, refusing } from '../errors';
import { publicProcedure, router } from '../trpc';

/**
 * The renderer's side of a run: start one, watch it, answer it, stop it.
 *
 * This layer only translates. It owns no state and reaches no database — every
 * decision about what a request means belongs to the runner, which is also what
 * a second caller (an editor speaking ACP, say) would be given instead of this.
 */

/** A run's request; the model is named per-send because the user can switch it. */
const runInput = z.object({
  threadId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
});

const attachInput = z.object({
  threadId: z.string().min(1),
  /** Exclusive lower bound; -1 replays the log from its first event. */
  from: z.number().int().default(-1),
});

/**
 * A thread's event log as a stream of envelopes.
 *
 * Unsubscribing detaches this reader and nothing else — a run outlives its
 * readers, so closing a tab must never be what stops a turn. Stopping one is
 * `abort`, and only that.
 */
function attach(runner: Runner, threadId: string, from: number) {
  return observable<EventEnvelope>((emit) => {
    const stream = runner.subscribe(threadId, from);
    if (!stream) {
      emit.complete();
      return;
    }
    const reader = stream.getReader();
    let detached = false;
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (detached) return;
          if (done) break;
          emit.next(value);
        }
        emit.complete();
      } catch (error) {
        if (!detached) emit.error(new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: error }));
      }
    })();
    return () => {
      detached = true;
      void reader.cancel();
    };
  });
}

const attempt = refusing([InteractionConflict, conflict], [InvalidInteractionDecision, badRequest]);

export const chatRouter = router({
  /**
   * Start a turn. The log exists by the time this resolves, so the caller can
   * attach afterwards and still replay the run from its first event — even one
   * that finished in between.
   */
  send: publicProcedure
    .input(runInput.extend({ message: z.custom<AtriumUIMessage>() }))
    .mutation(({ ctx, input }) => {
      const { message, ...run } = input;
      if (message?.role !== 'user') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'chat takes a user message' });
      }
      ctx.runner.start({ ...run, userMessage: message });
    }),

  /** Watch a run from `from`. Completes at once when the thread has no log. */
  events: publicProcedure
    .input(attachInput)
    .subscription(({ ctx, input }) => attach(ctx.runner, input.threadId, input.from)),

  /**
   * Rejoin a run already in flight — what opening a thread does. A log whose
   * run has ended is not replayed: its message is in the database the caller
   * seeds from, so replaying it would show the turn twice.
   */
  rejoin: publicProcedure
    .input(attachInput)
    .subscription(({ ctx, input }) =>
      ctx.runner.isRunning(input.threadId)
        ? attach(ctx.runner, input.threadId, input.from)
        : observable<EventEnvelope>((emit) => emit.complete()),
    ),

  /**
   * The user's decision for a call a running turn is waiting on. Accepting it
   * only wakes that call: whether the tool then runs, and what it returns,
   * arrives on the run's own stream.
   */
  decide: publicProcedure
    .input(z.object({ threadId: z.string().min(1), interaction: decideInteractionSchema }))
    .mutation(({ ctx, input }) =>
      attempt(() => ({ status: ctx.runner.respond(input.threadId, input.interaction) })),
    ),

  /**
   * Stop a thread's generation. Aborts the loop in the main process — detaching
   * a reader cannot, because the run outlives its readers — and whatever was
   * generated so far is persisted as the turn ends.
   */
  abort: publicProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .mutation(({ ctx, input }) => ({ aborted: ctx.runner.abort(input.threadId) })),

  /** Fold a thread on demand (the user's /compact). Needs a model for the summary. */
  compact: publicProcedure
    .input(runInput.omit({ permissionMode: true }))
    .mutation(async ({ ctx, input }) => ({ compacted: await ctx.runner.compact(input) })),
});
