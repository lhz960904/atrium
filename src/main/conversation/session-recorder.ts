import type {
  AgentEvent,
  AgentMessage,
  AgentMessage as Message,
} from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createLogger } from '@main/utils/log';
import type { InteractionOutcome, InteractionRequest, RunStopReason } from '@shared/interactions';

import { recoverInterruptedRun } from './recovery';
import type { Conversation } from './store/conversation';

const log = createLogger('session');

/**
 * Everything one run writes into its session.
 *
 * Each finished message is appended as it lands rather than the whole turn
 * being written once it settles — the engine awaits its listeners, so the loop
 * cannot run ahead of the store, and a turn cut short by a crash keeps whatever
 * it had already produced. Deltas are never written: a message is the smallest
 * unit that is complete enough to be worth keeping.
 *
 * The run is bracketed by an operation record. That bracket is what makes the
 * run addressable when the session is read back, and an unfinished one is how a
 * later boot knows the run never got to end.
 */

export type RunTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  /** USD, summed from what each turn reported — never recomputed from rates. */
  costUsd: number;
};

export type RunOutcome = 'completed' | 'aborted' | 'failed';

export type SessionRecorder = {
  /** Open the run, and record the turn that started it under the id its author
   *  already gave it. */
  begin(prompt?: { id: string; message: Message }): Promise<void>;
  /** Fold one engine event into the session. */
  observe(event: AgentEvent): Promise<void>;
  /** Record that the run is waiting on the user for this request. */
  interactionRequested(request: InteractionRequest): Promise<void>;
  /** Record how the request was settled, before the call it gates continues. */
  interactionResolved(request: InteractionRequest, outcome: InteractionOutcome): Promise<void>;
  /** Close the run, repairing what an interrupted one left behind. */
  end(outcome: RunOutcome, reason?: RunStopReason): Promise<void>;
  readonly totals: RunTotals;
  /** Set when a turn ended in a provider error. */
  readonly failure: string | undefined;
  /** The prompt size at the last turn's end — compaction's counting base. */
  readonly contextTokens: number | undefined;
  /** Whether the run put anything in the session. */
  readonly wrote: boolean;
  /** UI id of the assistant message actually stored by this execution. */
  readonly messageId: string | undefined;
};

const isAssistant = (m: AgentMessage): m is AgentMessage & AssistantMessage =>
  m.role === 'assistant';

/** What a finished turn actually put in front of the model, cached parts included. */
const contextSizeOf = (usage: AssistantMessage['usage']): number =>
  usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

export function createSessionRecorder(opts: {
  conversation: Conversation;
  /** The run's id, which is also its operation record's id. */
  runId: string;
}): SessionRecorder {
  const { conversation, runId } = opts;
  const totals: RunTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    costUsd: 0,
  };
  let contextTokens: number | undefined;
  let failure: string | undefined;
  let wrote = false;
  let messageId: string | undefined;
  let attempt = 0;
  let operationOpen = false;

  return {
    async begin(prompt) {
      // A lane holds one operation at a time, so anything still open has to be
      // closed first. It is open because the run that owned it never got to end
      // — the app died mid-turn — so its gaps are repaired here, before this
      // run's own entries land after them.
      for (const open of await conversation.openRuns()) {
        log.info(`recovering run ${open.id}, superseded by ${runId}`);
        await recoverInterruptedRun(conversation, open.id, 'interrupted');
      }
      await conversation.startRun(runId);
      operationOpen = true;
      if (prompt) {
        await conversation.appendPrompt(prompt.id, prompt.message);
        wrote = true;
      }
    },

    async observe(event) {
      if (event.type !== 'message_end') return;
      const { message } = event;

      if (isAssistant(message)) {
        // A provider failure ends the turn as an errored assistant message
        // rather than an exception, so this is the only place a caller that
        // isn't reading the stream can learn the run failed.
        if (message.stopReason === 'error') {
          failure = message.errorMessage ?? 'the model call failed';
        }
        const { usage } = message;
        totals.input += usage.input;
        totals.output += usage.output;
        totals.cacheRead += usage.cacheRead;
        totals.cacheWrite += usage.cacheWrite;
        totals.total += usage.totalTokens;
        totals.costUsd += usage.cost.total;
        contextTokens = contextSizeOf(usage);
        // A turn that produced nothing (the provider errored before its first
        // block) is not kept: an empty content list is rejected outright when
        // it comes back as history, which would wedge the thread for good.
        if (message.content.length === 0) return;

        const entryId = await conversation.appendTurn(message);
        wrote = true;
        messageId = runId;
        await conversation.recordUsage({
          runId,
          entryId,
          attempt: ++attempt,
          stopReason: message.stopReason,
          usage,
        });
        return;
      }

      if (message.role === 'toolResult') {
        await conversation.appendToolResult(message);
        wrote = true;
      }
    },

    // pi has no state for "waiting on the user", so it rides in entries of our
    // own. A request settles once, so each phase is written exactly once.
    async interactionRequested(request) {
      await conversation.recordInteractionRequested(request);
      wrote = true;
    },

    async interactionResolved(request, outcome) {
      await conversation.recordInteractionResolved(request, outcome);
      wrote = true;
    },

    async end(outcome, reason) {
      // begin may fail before opening the bracket, or after opening it while
      // writing the prompt. Only close the operation we actually own.
      if (!operationOpen) return;
      if (outcome === 'completed') {
        await conversation.finishRun(runId, outcome);
      } else {
        // A run that stopped or failed can leave calls with no result. Recording
        // why first means a boot that never gets past here can still say it.
        await conversation.recordRunStop(runId, reason ?? 'interrupted');
        await recoverInterruptedRun(conversation, runId, reason ?? 'interrupted', outcome);
      }
      wrote = true;
      operationOpen = false;
    },

    get totals() {
      return totals;
    },
    get failure() {
      return failure;
    },
    get contextTokens() {
      return contextTokens;
    },
    get wrote() {
      return wrote;
    },
    get messageId() {
      return messageId;
    },
  };
}
