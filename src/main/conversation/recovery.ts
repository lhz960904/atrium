import type { Entry, AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { InteractionOutcome, RunStopReason } from '@shared/interactions';
import { INTERACTION_ENTRY, type InteractionEntryData } from './project';
import type { Conversation } from './store/conversation';

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
 * A stand-in result for every call in a run that never got one. A turn cut
 * short leaves a call whose result never arrived, and the transcript is read
 * back from these entries, so an unpaired one would sit in the conversation
 * looking like it were still running.
 */
function missingResults(messages: Message[]): ToolResultMessage[] {
  const answered = new Set(
    messages.flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : [])),
  );
  const missing: ToolResultMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const content of (message as AssistantMessage).content) {
      if (!isToolCall(content) || answered.has(content.id)) continue;
      answered.add(content.id);
      missing.push({
        role: 'toolResult',
        toolCallId: content.id,
        toolName: content.name,
        content: [{ type: 'text', text: INTERRUPTED }],
        isError: true,
        timestamp: message.timestamp,
      });
    }
  }
  return missing;
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

/** One run, and the entries inside its bracket. */
type Run = { id: string; finished: boolean; entries: Entry[] };

/**
 * Every run in the lane with the entries it produced.
 *
 * A run's entries are the ones between its own start and the next run's: the
 * lane runs one operation at a time, so nothing after that point can be its own.
 */
async function readRuns(conversation: Conversation): Promise<Run[]> {
  const [records, entries] = await Promise.all([conversation.records(), conversation.entries()]);
  const starts = records.filter((record) => record.type === 'operation_started');
  const closed = new Set(
    records.flatMap((record) => (record.type === 'operation_finished' ? [record.runId] : [])),
  );
  return starts.map((started, index) => {
    const until = starts[index + 1]?.seq ?? Number.POSITIVE_INFINITY;
    return {
      id: started.id,
      finished: closed.has(started.id),
      entries: entries.filter((entry) => entry.seq > started.seq && entry.seq < until),
    };
  });
}

/** Whether this run left anything half-written for a reader to trip over. */
function hasGaps(run: Run): boolean {
  const messages = run.entries.flatMap((entry) =>
    entry.type === 'message' ? [entry.message as Message] : [],
  );
  if (missingResults(messages).length > 0) return true;
  const interactions = interactionsOf(run.entries);
  return interactions.some((data) => !settlementOf(interactions, data.request.toolCall.id));
}

/** Pair what this run left open, and close its bracket if it is still open. */
async function repair(
  conversation: Conversation,
  run: Run,
  reason: RunStopReason,
  outcome: 'aborted' | 'failed',
): Promise<void> {
  const interactions = interactionsOf(run.entries);
  const messages = run.entries.flatMap((entry) =>
    entry.type === 'message' ? [entry.message as Message] : [],
  );

  for (const result of missingResults(messages)) {
    await conversation.appendInterruptedResult(run.id, result.toolCallId, result);
  }

  for (const request of interactions.map((data) => data.request)) {
    if (settlementOf(interactions, request.toolCall.id)) continue;
    await conversation.settleInteraction(request, { kind: 'interrupted', reason });
  }

  // A run whose bracket already closed keeps the outcome it recorded; writing a
  // second one would claim it ended twice.
  if (!run.finished) await conversation.finishRun(run.id, outcome);
}

/** Close off one run the caller knows is open — what frees the lane for the next. */
export async function recoverInterruptedRun(
  conversation: Conversation,
  runId: string,
  reason: RunStopReason,
  /** How the run is closed: a failure keeps saying so, everything else stopped. */
  outcome: 'aborted' | 'failed' = 'aborted',
): Promise<void> {
  const run = (await readRuns(conversation)).find((candidate) => candidate.id === runId);
  if (!run || run.finished) return;
  await repair(conversation, run, reason, outcome);
}

/**
 * Close off everything the last process left half-written, across every run.
 *
 * A run is repaired because it left a gap, not because its bracket is open.
 * Those usually coincide — a lost run leaves both — but they can come apart:
 * if writing a tool result failed while the run went on to finish, the bracket
 * closed over a call that never got one. Keying the repair on the bracket left
 * that card spinning in the transcript with nothing that would ever fix it,
 * because the run reads as completed.
 *
 * Every write here has a derived id, so a second pass over a repaired run adds
 * nothing.
 */
export async function repairConversation(
  conversation: Conversation,
  reason: RunStopReason = 'interrupted',
): Promise<void> {
  for (const run of await readRuns(conversation)) {
    if (run.finished && !hasGaps(run)) continue;
    await repair(conversation, run, reason, 'aborted');
  }
}
