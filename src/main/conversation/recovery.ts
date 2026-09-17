import type { Entry, AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { ToolCall } from '@earendil-works/pi-ai';
import type { InteractionOutcome, InteractionRequest, RunStopReason } from '@shared/interactions';
import { sealDanglingToolCalls } from './history';
import { INTERACTION_ENTRY, type InteractionEntryData } from './project';
import { RUN_STOP_ENTRY, type RunStopEntryData, type ThreadSession } from './store/session';

/**
 * What a run that never ended left behind, and how it is closed.
 *
 * A lost run leaves calls with no result, and a provider rejects any later
 * request whose history holds one. Recovery pairs each of them with what is
 * actually known — a decision the user made, a question nobody answered, or
 * plainly that the outcome is unknown — and then closes the run. It never
 * executes anything: a call that was approved before the crash may or may not
 * have run, and saying either would be a guess.
 */

const UNKNOWN: Record<RunStopReason, string> = {
  user_cancelled: 'The run was stopped before this tool returned; its outcome is unknown.',
  clarification_cancelled:
    'The turn was taken back before this tool returned; its outcome is unknown.',
  app_shutdown: 'The app quit before this tool returned; its outcome is unknown.',
  interrupted: 'The previous execution was interrupted; the tool outcome is unknown.',
};

const interactionsOf = (entries: Entry[]): InteractionEntryData[] =>
  entries.flatMap((entry) =>
    entry.type === 'custom' && entry.customType === INTERACTION_ENTRY
      ? [entry.data as InteractionEntryData]
      : [],
  );

const settlementOf = (
  interactions: InteractionEntryData[],
  toolCallId: string,
): InteractionOutcome | undefined =>
  interactions.findLast(
    (data): data is Extract<InteractionEntryData, { phase: 'resolved' }> =>
      data.phase === 'resolved' && data.request.toolCall.id === toolCallId,
  )?.outcome;

const askedOf = (
  interactions: InteractionEntryData[],
  toolCallId: string,
): InteractionRequest | undefined =>
  interactions.find((data) => data.request.toolCall.id === toolCallId)?.request;

/** What to tell the model about a call whose result never arrived. */
function interruptionText(
  interactions: InteractionEntryData[],
  call: ToolCall,
  reason: RunStopReason,
): string {
  const outcome = settlementOf(interactions, call.id);
  if (outcome?.kind === 'denied') {
    const reason = outcome.reason?.trim();
    // Both halves matter to the model: that it was denied, and why.
    return reason
      ? `The user denied this operation: ${reason}`
      : 'The user denied this operation; it was not run.';
  }
  if (outcome?.kind === 'cancelled') return 'The user took the question back unanswered.';
  // Still waiting when the run ended: the decision died with it, so nothing ran.
  if (outcome === undefined && askedOf(interactions, call.id)) {
    return 'The request expired when the run ended; this call was not executed.';
  }
  return UNKNOWN[reason];
}

/** The reason a read-only transcript shows for a call with no result. */
export function interruptionTextFromEntries(entries: Entry[], call: ToolCall): string {
  const stop = entries.findLast(
    (entry) => entry.type === 'custom' && entry.customType === RUN_STOP_ENTRY,
  );
  const reason =
    (stop?.type === 'custom' ? (stop.data as RunStopEntryData).reason : undefined) ?? 'interrupted';
  return interruptionText(interactionsOf(entries), call, reason);
}

/** The entries a run produced: everything between its start and the next run's. */
async function readRun(conversation: ThreadSession, runId: string) {
  const records = await conversation.records();
  const started = records.find(
    (record) => record.type === 'operation_started' && record.id === runId,
  );
  if (!started) return undefined;
  const finished = records.some(
    (record) => record.type === 'operation_finished' && record.runId === runId,
  );
  const next = records.find(
    (record) => record.type === 'operation_started' && record.seq > started.seq,
  );
  const entries = await conversation.entries();
  const own = entries.filter(
    (entry) => entry.seq > started.seq && entry.seq < (next?.seq ?? Number.POSITIVE_INFINITY),
  );
  return { finished, entries: own };
}

export async function recoverInterruptedRun(
  conversation: ThreadSession,
  runId: string,
  reason: RunStopReason,
  /** How the run is closed: a failure keeps saying so, everything else stopped. */
  outcome: 'aborted' | 'failed' = 'aborted',
): Promise<void> {
  const run = await readRun(conversation, runId);
  if (!run || run.finished) return;

  const interactions = interactionsOf(run.entries);
  const messages = run.entries.flatMap((entry) =>
    entry.type === 'message' ? [entry.message as Message] : [],
  );
  const answered = new Set(
    messages.flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : [])),
  );

  for (const message of sealDanglingToolCalls(messages, (call) =>
    interruptionText(interactions, call, reason),
  )) {
    if (message.role !== 'toolResult' || answered.has(message.toolCallId)) continue;
    answered.add(message.toolCallId);
    await conversation.appendInterruptedResult(runId, message.toolCallId, message);
  }

  for (const request of interactions.map((data) => data.request)) {
    if (settlementOf(interactions, request.toolCall.id)) continue;
    await conversation.settleInteraction(request, { kind: 'interrupted', reason });
  }

  await conversation.finishRun(runId, outcome);
}
