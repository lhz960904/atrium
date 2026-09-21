import {
  type AgentMessage,
  buildSessionContext,
  type Entry,
  type LaneRecord,
  type MessageEntry,
  type OperationFinishedRecord,
} from '@earendil-works/pi-agent-core';
import type { AtriumMessageMetadata, AtriumUIMessage } from '@shared/chat';
import type { InteractionOutcome, InteractionRequest } from '@shared/interactions';
import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@shared/protocol';
import { approvalFields } from '@shared/tool-part';
import {
  mergeAssistantMessage,
  mergeUserMessage,
  type ToolStateExtra,
  type ToolStateExtras,
} from './ui-messages';

/**
 * A session as the rest of the app reads it.
 *
 * The store keeps a flat, ordered stream: one entry per message, plus records
 * that bracket the runs those messages were produced by. The renderer wants the
 * opposite shape — a run folded into a single assistant message carrying its
 * steps, its cost and its tool cards. This is the one place that turns the
 * first into the second, by rebuilding the row shape the existing converters
 * already merge, so there is still exactly one implementation of that merge.
 *
 * Entries and records share one per-session sequence, which is what makes a run
 * addressable at all: its entries are the ones whose seq falls inside its
 * bracket.
 */

/** A run's wait on the user, recorded when asked and again when settled. */
export const INTERACTION_ENTRY = 'atrium.interaction';

export type InteractionEntryData =
  | { phase: 'requested'; request: InteractionRequest }
  | { phase: 'resolved'; request: InteractionRequest; outcome: InteractionOutcome };

type Run = {
  id: string;
  startSeq: number;
  endSeq: number;
  startedAt: number;
  finishedAt?: number;
};

const isMessage = (entry: Entry): entry is MessageEntry => entry.type === 'message';

/** The runs a session's records describe, in order. */
function runsOf(records: LaneRecord[]): Run[] {
  const finished = new Map<string, OperationFinishedRecord>();
  for (const record of records) {
    if (record.type === 'operation_finished') finished.set(record.runId, record);
  }
  const runs: Run[] = [];
  for (const record of records) {
    if (record.type !== 'operation_started') continue;
    const end = finished.get(record.id);
    runs.push({
      id: record.id,
      startSeq: record.seq,
      endSeq: end?.seq ?? Number.POSITIVE_INFINITY,
      startedAt: record.timestamp,
      finishedAt: end?.timestamp,
    });
  }
  runs.sort((a, b) => a.startSeq - b.startSeq);
  // A run with no end is still streaming or waiting, or was cut off.
  // Its entries reach to wherever the next run begins — a lane runs one
  // operation at a time, so nothing after that point can be its own.
  for (const [index, run] of runs.entries()) {
    if (run.endSeq === Number.POSITIVE_INFINITY) {
      run.endSeq = runs[index + 1]?.startSeq ?? Number.POSITIVE_INFINITY;
    }
  }
  return runs;
}

/**
 * What the run spent, summed from the usage its records recorded. The cost is
 * the provider's own figure, carried on every usage record — a reader must
 * never reprice tokens, or what it shows stops matching what was billed.
 *
 * Only records naming this run count, which leaves out the calls made beside
 * it (a title, a summary): those spent on the thread's behalf, not on this
 * turn's, and the usage page is where a thread's whole bill is read.
 */
function usageOf(records: LaneRecord[], runId: string): Partial<AtriumMessageMetadata> {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const cost = { input: 0, output: 0, cache: 0, total: 0 };
  let contextTokens: number | undefined;
  for (const record of records) {
    if (record.type !== 'usage' || record.runId !== runId) continue;
    const { usage } = record;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    totals.total += usage.totalTokens;
    cost.input += usage.cost.input;
    cost.output += usage.cost.output;
    cost.cache += usage.cost.cacheRead + usage.cost.cacheWrite;
    cost.total += usage.cost.total;
    // The prompt at the end of the latest turn, which is compaction's base.
    if (record.cause === 'assistant') {
      contextTokens =
        usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    }
  }
  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheReadTokens: totals.cacheRead,
    cacheCreationTokens: totals.cacheWrite,
    totalTokens: totals.total,
    cost,
    ...(contextTokens === undefined ? {} : { contextTokens }),
  };
}

/** The model that produced a run, read off the turns themselves. */
function modelOf(messages: Message[]): { providerId?: string; modelId?: string } {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const turn = message as AssistantMessage;
    if (turn.provider) return { providerId: turn.provider, modelId: turn.model };
  }
  return {};
}

/**
 * Tool states pi has no slot for, keyed by call id, folded from the interaction
 * entries in order. A settlement replaces the request it answers, so only a
 * request nobody settled still reads as waiting.
 */
function toolStatesOf(entries: Entry[]): ToolStateExtras {
  const states: ToolStateExtras = {};
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== INTERACTION_ENTRY) continue;
    const data = entry.data as InteractionEntryData;
    const { id: callId } = data.request.toolCall;
    const approval = { id: data.request.id };
    if (data.phase === 'requested') {
      states[callId] =
        data.request.kind === 'approval'
          ? { state: 'approval-requested', approval }
          : { state: 'input-available' };
      continue;
    }
    const fields = approvalFields(data.request.id, data.outcome);
    if (fields) states[callId] = fields as ToolStateExtra;
    else delete states[callId];
  }
  return states;
}

/**
 * A session's conversation, in the shape the renderer consumes.
 *
 * Entries already arrive in the order they happened, so this walks them once
 * and emits what each one stands for. A run is the only thing that spans
 * several: its turns and their results fold into a single message, emitted
 * where the first of them landed, so a fold between two runs stays between
 * them rather than being appended after everything else.
 */
export function getUIMessages(entries: Entry[], records: LaneRecord[]): AtriumUIMessage[] {
  const runs = runsOf(records);
  const out: AtriumUIMessage[] = [];
  const folded = new Set<string>();

  for (const entry of entries) {
    // A fold is shown where it happened, as its own divider; the messages it
    // folded away stay in the list above it.
    if (entry.type === 'compaction') {
      out.push({
        id: entry.id,
        role: 'user',
        parts: [{ type: 'text', text: entry.summary }],
        metadata: { kind: 'compaction', createdAt: entry.timestamp },
      } as AtriumUIMessage);
      continue;
    }
    if (!isMessage(entry)) continue;

    // The turn the user opened a run with is its own message, not part of the
    // assistant's; everything the model produced folds into one.
    const message = entry.message as Message;
    if (message.role === 'user') {
      out.push(mergeUserMessage(entry.id, message as UserMessage, { createdAt: entry.timestamp }));
      continue;
    }

    const run = runs.find((each) => entry.seq > each.startSeq && entry.seq < each.endSeq);
    if (!run || folded.has(run.id)) continue;
    folded.add(run.id);

    const own = entries.filter((each) => each.seq > run.startSeq && each.seq < run.endSeq);
    const produced = own
      .filter(isMessage)
      .map((each) => each.message as Message)
      .filter((each): each is AssistantMessage | ToolResultMessage => each.role !== 'user');
    out.push(
      mergeAssistantMessage(run.id, {
        messages: produced,
        metadata: {
          createdAt: run.startedAt,
          ...(run.finishedAt === undefined ? {} : { durationMs: run.finishedAt - run.startedAt }),
          ...modelOf(produced),
          ...usageOf(records, run.id),
        },
        toolStates: toolStatesOf(own),
      }),
    );
  }

  return out;
}

/**
 * The transcript the engine runs on. pi's own builder does the folding: it cuts
 * at the newest compaction entry and turns it back into the summary that stands
 * for everything before it, which is the same view the fold itself produced.
 *
 * Typed in pi's vocabulary rather than the frozen one on purpose: a compaction
 * summary is a role pi owns, which never reaches storage or the wire — the
 * reader is handed a divider instead.
 */
export function getAgentMessages(entries: Entry[]): AgentMessage[] {
  return buildSessionContext(entries).messages;
}

/** Tool calls in the branch that never got a result. */
export function openToolCalls(entries: Entry[]): ToolCall[] {
  const answered = new Set(
    entries.flatMap((entry) =>
      isMessage(entry) && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : [],
    ),
  );
  const open: ToolCall[] = [];
  for (const entry of entries) {
    if (!isMessage(entry) || entry.message.role !== 'assistant') continue;
    for (const content of (entry.message as AssistantMessage).content) {
      if (content.type === 'toolCall' && !answered.has((content as ToolCall).id)) {
        open.push(content as ToolCall);
      }
    }
  }
  return open;
}
