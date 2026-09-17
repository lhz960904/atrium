import type { Entry, AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import type { InteractionOutcome, RunStopReason } from '@shared/interactions';
import { INTERACTION_ENTRY, type InteractionEntryData } from './project';
import type { ThreadSession } from './store/session';

/**
 * What a run that never ended left behind, and how it is closed.
 *
 * A lost run leaves calls with no result. The transcript a reader sees is built
 * from these entries, so an unpaired call sits there looking like it is still
 * running — pairing it is what settles the card, and closing the run is what
 * frees the lane for the next one. The model is not the reason: pi pairs
 * orphans itself on the way to a provider.
 *
 * Nothing is ever executed here. A call approved before the crash may or may
 * not have run, and saying either would be a guess.
 */

/**
 * What a call with no result is told.
 *
 * One line for every way a run can be lost: which one it was is recorded beside
 * it and shown by the card, and the model only needs to know the call was cut
 * off rather than how.
 */
const INTERRUPTED = 'The previous execution was interrupted; the tool outcome is unknown.';

const isToolCall = (content: { type: string }): content is ToolCall => content.type === 'toolCall';

/**
 * Pair every tool call in a run with a result. A turn cut short leaves a call
 * whose result never arrived, and the transcript is read back from these
 * entries, so an unpaired one would sit in the conversation looking like it
 * were still running.
 */
function sealDanglingToolCalls(messages: Message[]): Message[] {
  const answered = new Set(
    messages.flatMap((m) => (m.role === 'toolResult' ? [m.toolCallId] : [])),
  );
  const out: Message[] = [];
  for (const message of messages) {
    out.push(message);
    if (message.role !== 'assistant') continue;
    for (const content of (message as AssistantMessage).content) {
      if (!isToolCall(content) || answered.has(content.id)) continue;
      answered.add(content.id);
      out.push({
        role: 'toolResult',
        toolCallId: content.id,
        toolName: content.name,
        content: [{ type: 'text', text: INTERRUPTED }],
        isError: true,
        timestamp: message.timestamp,
      });
    }
  }
  return out;
}

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

  for (const message of sealDanglingToolCalls(messages)) {
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
