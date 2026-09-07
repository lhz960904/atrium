import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, ToolCall } from '@shared/protocol';
import type { ParkedCall } from './approvals';
import { withErrorText } from './tool-result';
import { storedMessage } from './vocabulary';

/** One pi message a run produced, ready to be stored as its own row. */
export type RunRow = {
  id: string;
  role: 'assistant' | 'toolResult';
  message: Message;
  metadata?: Record<string, unknown> | null;
};

/** What the run's model calls spent, summed across its turns. */
export type RunTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

export type RunRecorder = {
  /** Fold one engine event into the run's accumulated state. */
  observe(event: AgentEvent): void;
  /**
   * The rows to store, with the run's metadata on the first one. Closes every
   * unanswered call first, so the result is safe to read back as history.
   */
  finalize(metadata: Record<string, unknown>): RunRow[];
  readonly totals: RunTotals;
  /** The prompt size at the last turn's end — compaction's counting base. */
  readonly contextTokens: number | undefined;
  /** Set when a turn ended in a provider error. */
  readonly failure: string | undefined;
};

const isAssistant = (m: Message): m is AssistantMessage => m.role === 'assistant';

/** What a finished turn actually put in front of the model, cached parts included. */
const contextSizeOf = (usage: AssistantMessage['usage']): number =>
  usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

/**
 * Accumulates a run's messages as the rows it will be stored as.
 *
 * Storing at the end rather than per event is deliberate: a run is one stored
 * unit (its rows are replaced together, keeping the group's position when a
 * continuation extends it), and the run-level metadata a reader needs — how
 * long the turn took, what it cost — only exists once the turn is over.
 */
export function createRunRecorder(opts: {
  runId: string;
  /** Calls handed back to the user: they get no result row this run. */
  parked: Map<string, ParkedCall>;
  /** Rows this run stored earlier, when the turn is a continuation. */
  seed?: RunRow[];
}): RunRecorder {
  const rows: RunRow[] = [...(opts.seed ?? [])];
  const totals: RunTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let contextTokens: number | undefined;
  let failure: string | undefined;

  return {
    observe(event: AgentEvent): void {
      if (event.type !== 'message_end') return;
      const message = storedMessage(event.message);

      if (isAssistant(message)) {
        // A provider failure ends the turn as an errored assistant message
        // rather than an exception, so this is the only place a caller that
        // isn't reading the stream can learn the run failed.
        if (message.stopReason === 'error') {
          failure = message.errorMessage ?? 'the model call failed';
        }
        const usage = message.usage;
        totals.input += usage.input;
        totals.output += usage.output;
        totals.cacheRead += usage.cacheRead;
        totals.cacheWrite += usage.cacheWrite;
        totals.total += usage.totalTokens;
        // The prompt at turn end — the honest base for compaction's threshold,
        // where the cumulative figure would count a tool loop many times over.
        // Not `input + output`: a cached prompt bills only its uncached part to
        // `input`, so that pair reads as a fraction of what was actually sent.
        contextTokens = contextSizeOf(usage);
        // A turn that produced nothing (the provider errored before its first
        // block) is not stored: an empty content list is rejected outright when
        // it comes back as history, which would wedge the thread for good.
        if (message.content.length > 0) {
          rows.push({
            id: `${opts.runId}:${rows.filter((r) => r.role === 'assistant').length}`,
            role: 'assistant',
            message,
          });
        }
        return;
      }

      if (message.role === 'toolResult') {
        // A parked call is stored as still open, so a reload shows the ask again
        // and the decision can still land on it.
        if (opts.parked.has(message.toolCallId)) return;
        message.details = withErrorText(message.details, message.content, message.isError);
        rows.push({ id: message.toolCallId, role: 'toolResult', message });
      }
    },

    finalize(metadata: Record<string, unknown>): RunRow[] {
      if (rows.length === 0) return rows;
      stampParkedCalls(rows, opts.parked);
      sealUnansweredCalls(rows, opts.parked);
      rows[0].metadata = { ...rows[0].metadata, ...metadata };
      return rows;
    },

    get totals() {
      return totals;
    },
    get contextTokens() {
      return contextTokens;
    },
    get failure() {
      return failure;
    },
  };
}

/**
 * Record each parked call's pending state on the turn that made it. The row
 * vocabulary has no slot for "waiting on the user" — a call is open or it has a
 * result — so the UI state rides in the row's metadata, which is where every
 * other tool-state extra already lives.
 */
function stampParkedCalls(rows: RunRow[], parked: Map<string, ParkedCall>): void {
  if (parked.size === 0) return;
  for (const row of rows) {
    if (row.message.role !== 'assistant') continue;
    const states: Record<string, unknown> = {};
    for (const content of row.message.content) {
      if (content.type !== 'toolCall') continue;
      const call = parked.get((content as ToolCall).id);
      if (!call) continue;
      states[call.toolCallId] = call.approvalId
        ? { state: 'approval-requested', approval: { id: call.approvalId } }
        : { state: 'input-available' };
    }
    if (Object.keys(states).length === 0) continue;
    const existing = (row.metadata?.toolStates ?? {}) as Record<string, unknown>;
    row.metadata = { ...row.metadata, toolStates: { ...existing, ...states } };
  }
}

const SEAL_ERROR = 'Stopped before the tool returned.';

/**
 * Give every tool call a result row. A stopped turn leaves its in-flight call
 * unanswered, and both the provider (which rejects an unpaired tool call in the
 * history) and the card (which would sit spinning forever) need it closed.
 */
function sealUnansweredCalls(rows: RunRow[], parked: Map<string, ParkedCall>): void {
  const answered = new Set([
    ...parked.keys(),
    ...rows.flatMap((row) => (row.role === 'toolResult' ? [row.id] : [])),
  ]);
  const sealed: RunRow[] = [];
  for (const row of rows) {
    sealed.push(row);
    if (row.message.role !== 'assistant') continue;
    for (const content of row.message.content) {
      if (content.type !== 'toolCall') continue;
      const call = content as ToolCall;
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      sealed.push({
        id: call.id,
        role: 'toolResult',
        message: {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: SEAL_ERROR }],
          details: { errorText: SEAL_ERROR },
          isError: true,
          timestamp: row.message.timestamp,
        },
      });
    }
  }
  rows.length = 0;
  rows.push(...sealed);
}
