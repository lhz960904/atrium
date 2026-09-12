import {
  type AgentMessage,
  buildSessionContext,
  type Entry,
  type LaneRecord,
  type MessageEntry,
} from '@earendil-works/pi-agent-core';
import type { AtriumUIMessage } from '@shared/chat';
import type { AssistantMessage, Message, ToolCall } from '@shared/protocol';
import { mergeAssistantMessage, mergeUserMessage, type PiRow } from './ui-messages';

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

/** The state a parked tool call is waiting in, recorded as its own entry. */
export const APPROVAL_ENTRY = 'atrium.approval';

export type ApprovalEntryData = {
  toolCallId: string;
  /** Present when the pause is an approval; absent for a tool the user answers. */
  approvalId?: string;
};

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
  const finished = new Map<string, LaneRecord & { type: 'operation_finished' }>();
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
  // A run with no end is still streaming, or was left parked, or was cut off.
  // Its entries reach to wherever the next run begins — a lane runs one
  // operation at a time, so nothing after that point can be its own.
  for (const [index, run] of runs.entries()) {
    if (run.endSeq === Number.POSITIVE_INFINITY) {
      run.endSeq = runs[index + 1]?.startSeq ?? Number.POSITIVE_INFINITY;
    }
  }
  return runs;
}

/** What the run cost, summed from the usage its records recorded. */
function usageOf(records: LaneRecord[], runId: string): Record<string, number> {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let contextTokens: number | undefined;
  for (const record of records) {
    if (record.type !== 'usage' || record.runId !== runId) continue;
    const { usage } = record;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    totals.total += usage.totalTokens;
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

/** Tool states pi has no slot for, keyed by call id, from the approval entries. */
function toolStatesOf(entries: Entry[]): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== APPROVAL_ENTRY) continue;
    const { toolCallId, approvalId } = entry.data as ApprovalEntryData;
    states[toolCallId] = approvalId
      ? { state: 'approval-requested', approval: { id: approvalId } }
      : { state: 'input-available' };
  }
  return states;
}

/**
 * The rows one run's entries stand for. Assistant turns keep the
 * `<runId>:<turn>` key the renderer folds them by; a tool result is keyed by
 * the call it answers, which is how the merge pairs the two.
 */
function rowsOf(run: Run, entries: Entry[], records: LaneRecord[]): PiRow[] {
  const messages = entries.filter(isMessage).map((entry) => entry.message as Message);
  const answered = messages.filter((m) => m.role === 'assistant');
  const metadata: Record<string, unknown> = {
    createdAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { durationMs: run.finishedAt - run.startedAt }),
    ...modelOf(messages),
    ...usageOf(records, run.id),
  };
  const toolStates = toolStatesOf(entries);
  if (Object.keys(toolStates).length > 0) metadata.toolStates = toolStates;

  const rows: PiRow[] = [];
  let turn = 0;
  for (const message of messages) {
    if (message.role === 'assistant') {
      rows.push({
        id: `${run.id}:${turn}`,
        runId: run.id,
        role: 'assistant',
        message: message as PiRow['message'],
        // Run-level bookkeeping rides on the first row, as it always has.
        metadata: turn === 0 ? metadata : null,
      });
      turn++;
    } else if (message.role === 'toolResult') {
      rows.push({
        id: message.toolCallId,
        runId: run.id,
        role: 'toolResult',
        message: message as PiRow['message'],
        metadata: null,
      });
    }
  }
  // A run whose first turn never landed still needs somewhere to carry its
  // metadata, or the card loses its timing and cost.
  if (answered.length === 0 && rows.length > 0) rows[0].metadata = metadata;
  return rows;
}

/** A session's conversation, in the shape the renderer consumes. */
export function projectMessages(entries: Entry[], records: LaneRecord[]): AtriumUIMessage[] {
  const runs = runsOf(records);
  const out: AtriumUIMessage[] = [];

  // A fold is shown where it happened, as its own divider; the messages it
  // folded away stay in the list above it.
  const folds = entries.filter((entry) => entry.type === 'compaction');
  const divider = (entry: Extract<Entry, { type: 'compaction' }>): AtriumUIMessage =>
    ({
      id: entry.id,
      role: 'user',
      parts: [{ type: 'text', text: entry.summary }],
      metadata: { kind: 'compaction', createdAt: entry.timestamp },
    }) as AtriumUIMessage;

  for (const run of runs) {
    const own = entries.filter((entry) => entry.seq > run.startSeq && entry.seq < run.endSeq);
    // The turn the user opened the run with is its own message, not part of the
    // assistant's; everything the model produced folds into one.
    for (const entry of own) {
      if (isMessage(entry) && entry.message.role === 'user') {
        out.push(
          mergeUserMessage({
            id: entry.id,
            runId: entry.id,
            role: 'user',
            message: entry.message as PiRow['message'],
            metadata: { createdAt: entry.timestamp },
          }),
        );
      }
    }
    const produced = own.filter((entry) => !(isMessage(entry) && entry.message.role === 'user'));
    const rows = rowsOf(run, produced, records);
    if (rows.length > 0) out.push(mergeAssistantMessage(run.id, rows));
    for (const fold of folds) {
      if (fold.seq > run.startSeq && fold.seq < run.endSeq) out.push(divider(fold));
    }
  }
  // A fold the user asked for happens between runs, so it belongs to none.
  for (const fold of folds) {
    if (!runs.some((run) => fold.seq > run.startSeq && fold.seq < run.endSeq)) {
      out.push(divider(fold));
    }
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
export function projectHistory(entries: Entry[]): AgentMessage[] {
  return buildSessionContext(entries).messages;
}

/** Tool calls in the branch that never got a result — the ones still parked. */
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
