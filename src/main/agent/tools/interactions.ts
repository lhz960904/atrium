import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolCall } from '@earendil-works/pi-ai';
import type { SessionRecorder } from '@main/conversation/session-recorder';
import type { ClarifyResult } from '@shared/chat-types';
import type { InteractionKind, InteractionOutcome } from '@shared/interactions';
import type { AgentSessionEvent } from '@shared/protocol';
import type { approvalGate } from '../permissions';
import type { HookSet } from '../runtime/hook-compose';
import type { PendingInteractions } from '../runtime/pending-interactions';
import type { ToolCtx } from './context';

const DENIED_TEXT = 'The user denied this operation. Do not retry it; adjust your approach.';

/**
 * What the model reads back from a clarification. The question text comes from
 * the call the model made, never from the client, so an answer can only fill in
 * what was actually asked.
 */
function clarificationResult(
  call: ToolCall,
  outcome: InteractionOutcome,
): AgentToolResult<ClarifyResult> {
  let details: ClarifyResult;
  if (outcome.kind === 'answered') {
    const { questions = [] } = call.arguments as { questions?: { question: string }[] };
    details = {
      answers: questions.map((item, index) => ({
        question: item.question,
        answer: outcome.answers[index] ?? '',
      })),
    };
  } else if (outcome.kind === 'cancelled') {
    details = { answers: [], cancelled: true };
  } else {
    throw new Error('The run stopped before the question was answered.');
  }
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
}

/**
 * Everything a run asks the user: approval for a call that crosses a boundary,
 * and a clarification the model requests. Each wait is recorded before the user
 * sees it and its decision is recorded before the call continues, so a decision
 * the store failed to keep can never let a tool run.
 */
export function toolInteractions(opts: {
  gate: ReturnType<typeof approvalGate>;
  pending: PendingInteractions;
  recorder: SessionRecorder;
  emit: (event: AgentSessionEvent) => void;
  signal: AbortSignal;
}): HookSet & { ask: NonNullable<ToolCtx['ask']> } {
  async function request(kind: InteractionKind, call: ToolCall): Promise<InteractionOutcome> {
    const waiting = opts.pending.open(kind, call);
    try {
      await opts.recorder.interactionRequested(waiting.request);
      opts.emit({ type: 'interaction_requested', request: waiting.request });
      const outcome = await waiting.response;
      await opts.recorder.interactionResolved(waiting.request, outcome);
      opts.emit({ type: 'interaction_resolved', request: waiting.request, outcome });
      return outcome;
    } catch (error) {
      waiting.cancel();
      // pi turns a throwing hook into a tool error and keeps going, so the run is
      // stopped here and the failure kept for its result.
      opts.pending.cancel(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  return {
    name: 'tool-interactions',
    beforeToolCall: async ({ toolCall, args }) => {
      if (!(await opts.gate(toolCall.name, args, toolCall.id))) return undefined;
      const outcome = await request('approval', toolCall);
      if (outcome.kind === 'denied') {
        return { block: true, reason: outcome.reason?.trim() || DENIED_TEXT };
      }
      // pi checks the signal again after this hook, so an approval accepted a
      // moment before a stop still never runs.
      if (outcome.kind === 'approved' || opts.signal.aborted) return undefined;
      throw new Error('The approval was not completed.');
    },
    ask: async (call) => clarificationResult(call, await request('clarification', call)),
  };
}
