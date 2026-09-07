import { randomUUID } from 'node:crypto';
import { Agent, type AgentEvent, type StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { PermissionMode } from '@shared/permissions';
import type { AgentSessionEvent, AssistantMessage, Message, ToolCall } from '@shared/protocol';
import type { Db } from '../db';
import { createLogger } from '../log';
import { recordTurn } from './memory/state';
import { type ApprovalContext, approvalGate } from './permissions';
import { applyResolutions, type ParkedCall, type Resolution } from './pi/approvals';
import { type Checkpoint, compactForTurn, withinTurnFold } from './pi/compaction';
import { type Complete, createCompleter } from './pi/complete';
import { composeContext } from './pi/context';
import { injectSystemReminder } from './pi/history';
import { injectContextBlocks, loadContextBlocks } from './pi/injectors';
import { createLoopDetector } from './pi/loop-detection';
import { projectAgentEvent } from './pi/projector';
import { screenshotTrim } from './pi/screenshot-trim';
import { summarizerFrom } from './pi/summarize';
import { estimateTokens } from './pi/tokens';
import { withErrorText } from './pi/tool-result';
import { scopeToolsToSkill } from './pi/tool-scope';
import { asPi, storedMessage } from './pi/vocabulary';
import { readSoul } from './profile/paths';
import { buildSystemPrompt, currentDateNote } from './prompts';
import type { RunContext } from './run-context';
import type { Sandbox } from './sandbox/types';
import { type ActiveSkill, SKILL_SCRATCH_KEY, type Skill } from './skills/types';
import type { AtriumTool } from './tools';
import { preserveActiveSkill } from './tools/builtins/skill';
import { preserveTodos } from './tools/builtins/todo';

const log = createLogger('agent');

/** One pi message a run produced, ready to be stored as its own row. */
export type RunRow = {
  id: string;
  role: 'assistant' | 'toolResult';
  message: Message;
  metadata?: Record<string, unknown> | null;
};

/**
 * How the turn ended, for a caller that isn't watching the event stream. A
 * model failure is not an exception — pi encodes it as an errored assistant
 * turn — so a headless caller can only tell success from failure if the run
 * reports it here.
 */
export type RunResult = {
  status: 'ok' | 'error';
  error?: string;
  /** Whether the run stored rows; false when it produced nothing to store. */
  stored: boolean;
};

/** What the turn cost, as the ledger records it. */
export type RunUsage = {
  messageId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

export type RunAgentOptions = {
  /** The run's own id: every message it produces is stored under it, and the
   *  renderer folds them into one assistant message by it. A continuation
   *  passes the id of the run it resumes. */
  runId: string;
  providerId: string;
  modelId: string;
  /** The model the engine runs, and how it reaches the provider. Resolved by
   *  the caller so this layer stays clear of the credential store. */
  piModel: Model<Api>;
  streamFn: StreamFn;
  getApiKey: (provider: string) => string | undefined;
  /** The thread's transcript as pi messages: what the engine runs on. */
  messages: Message[];
  workspaceRoot: string;
  threadId: string;
  db: Db;
  sandbox: Sandbox;
  /** Discovered skills: their index rides in the model's context, and an active
   *  one narrows the tools offered on the turns that follow. */
  skills: Skill[];
  /** Built once the run context exists — the tools that reach back into the turn
   *  close over it. */
  buildTools: (run: RunContext) => AtriumTool[];
  /** Active permission mode, surfaced in the system prompt so the model knows how approvals behave. */
  permissionMode: PermissionMode;
  /** What decides whether a call may run unasked; see agent/permissions. */
  permission: Omit<ApprovalContext, 'workspaceRoot' | 'abortSignal' | 'onReviewed'>;
  /** Decisions the user made about calls an earlier turn parked. Settled before
   *  the loop resumes, so the transcript is whole again by the time it runs. */
  resolutions?: Resolution[];
  /** The rows this run already stored, when the turn is a continuation: the run
   *  is replaced whole on write, so what came before has to be carried along. */
  resumeRows?: RunRow[];
  /** Where the run's events go — the thread's envelope log. */
  emit: (event: AgentSessionEvent) => void;
  /** Store the run's messages as its rows; injected so the agent layer stays
   *  independent of the server's persistence. */
  persist: (rows: RunRow[], opts: { markRead: boolean }) => void;
  /**
   * Record a compaction checkpoint covering `messages[0..coveredThrough]`.
   * Cross-turn folding only runs when this is supplied: a summary nobody stores
   * would be paid for again on every turn.
   */
  persistCheckpoint?: (checkpoint: Checkpoint) => void;
  /** Append the turn to the usage ledger. */
  recordUsage?: (usage: RunUsage) => void;
  /** Summarize the thread's opening message into a title (fire-and-forget). */
  generateTitle?: (input: { messages: Message[]; complete: Complete }) => void;
  abortSignal?: AbortSignal;
  /** Fires once when the turn settles (finished or aborted) — e.g. to collapse UI the run left on screen. */
  onSettled?: () => void;
};

/** Complex work routinely runs a dozen turns; this is the runaway brake. */
const MAX_TURNS = 100;

/** What the model is told about a call it will not get a result for this turn. */
const AWAITING_USER = 'Paused: waiting for the user. The turn ends here.';

const isAssistant = (m: Message): m is AssistantMessage => m.role === 'assistant';

/** What a finished turn actually put in front of the model, cached parts included. */
const contextSizeOf = (usage: AssistantMessage['usage']): number =>
  usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

/**
 * The agent loop: pi's `Agent` drives model→tool→model until it stops, and two
 * subscribers fan its events out — one projects them onto the wire, the other
 * accumulates the run's messages and writes them as rows when it settles.
 *
 * Writing at the end rather than per event is deliberate: a run is one stored
 * unit (its rows are replaced together, keeping the group's position when a
 * continuation extends it), and the run-level metadata a reader needs — how
 * long the turn took, what it cost — only exists once the turn is over.
 *
 * Resolves when the run has settled and every subscriber has finished with it.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunResult> {
  const soul = await readSoul();
  const startedAt = Date.now();

  const ctx: RunContext = {
    threadId: opts.threadId,
    db: opts.db,
    sandbox: opts.sandbox,
    workspaceRoot: opts.workspaceRoot,
    system: buildSystemPrompt(opts.workspaceRoot, {
      soul,
      platform: process.platform,
      mode: opts.permissionMode,
    }),
    providerId: opts.providerId,
    modelId: opts.modelId,
    // Transient UI channels (an auto-review badge, subagent activity) still
    // speak in stream chunks; they ride the wire as notices, which is exactly
    // what the renderer's notice router already expects.
    emit: (chunk) => {
      const c = chunk as { type: string };
      if (!c.type.startsWith('data-')) return;
      const { type, ...payload } = chunk as { type: string; [key: string]: unknown };
      opts.emit({ type: 'notice', name: type.slice('data-'.length), payload });
    },
    scratch: new Map(),
  };

  const tools = opts.buildTools(ctx);
  // A client-side tool is answered by the user, never executed.
  const clientSide = new Set(tools.filter((t) => t.clientSide).map((t) => t.name));

  const loop = createLoopDetector();
  const blocks = await loadContextBlocks({
    skills: opts.skills,
    workspaceRoot: opts.workspaceRoot,
  });
  // The standing blocks are injected downstream of the fold, so they aren't in
  // the messages it measures — but they are in every real prompt.
  const overheadTokens = estimateTokens(blocks.join('\n'));
  const preservers = [preserveTodos, preserveActiveSkill];
  const contextWindow = opts.piModel.contextWindow;
  const complete = createCompleter({
    model: opts.piModel,
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
  });
  const summarize = summarizerFrom(complete);
  opts.generateTitle?.({ messages: opts.messages, complete });
  const announceCompaction = (phase: 'start' | 'done'): void =>
    ctx.emit({ type: 'data-compaction', data: { phase }, transient: true });

  const compacted = opts.persistCheckpoint
    ? await compactForTurn({
        messages: opts.messages,
        summarize,
        contextWindow,
        preservers,
        emit: announceCompaction,
        persist: opts.persistCheckpoint,
      })
    : opts.messages;

  // Settle what the user decided before the loop sees the transcript: a parked
  // call has no result yet, and the engine will not run a call from a turn that
  // has already ended.
  const settled = await applyResolutions({
    resolutions: opts.resolutions ?? [],
    messages: compacted,
    tools: tools,
    emit: opts.emit,
    abortSignal: opts.abortSignal,
  });
  const messages = settled.length > 0 ? [...compacted, ...settled] : compacted;

  /** Calls this turn handed back to the user; they end it and stay open. */
  const parked = new Map<string, ParkedCall>();
  const gate = approvalGate({
    ...opts.permission,
    workspaceRoot: opts.workspaceRoot,
    abortSignal: opts.abortSignal,
    onReviewed: ({ toolCallId, subject }) =>
      ctx.emit({ type: 'data-autoReview', data: { toolCallId, subject }, transient: true }),
  });

  // A run that tripped the loop brake is offered nothing, so the model has to
  // answer in text; otherwise the active skill decides how wide the set is.
  const toolsForNextTurn = (): AtriumTool[] =>
    loop.stopped
      ? []
      : scopeToolsToSkill(tools, ctx.scratch.get(SKILL_SCRATCH_KEY) as ActiveSkill | undefined);

  const rows: RunRow[] = [...(opts.resumeRows ?? [])];
  // A continuation extends a turn that already reported itself: it keeps the
  // run's original start, and its cost adds to what the run had already spent.
  const prior = (opts.resumeRows?.[0]?.metadata ?? {}) as Record<string, number | undefined>;
  const openedAt = prior.createdAt ?? startedAt;
  for (const message of settled) {
    rows.push({ id: message.toolCallId, role: 'toolResult', message });
  }
  let turns = 0;
  let contextTokens: number | undefined;
  let failure: string | undefined;
  // What this segment spent. The ledger takes it as-is (a continuation is its
  // own billable call); the stored turn adds it to what the run spent before.
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

  const agent = new Agent({
    initialState: {
      systemPrompt: ctx.system,
      model: opts.piModel,
      tools,
      messages: asPi(messages),
    },
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
    /**
     * Everything the model sees beyond the stored transcript, rebuilt for each
     * request and thrown away after it. Order is the contract: the trim runs
     * first so the fold measures the smaller view, and the fold before the
     * standing blocks so it can never summarize them away; the blocks then
     * land on the first user turn (so they ride inside the cached prefix); the
     * date lands on the current one before any notice can claim that spot; and
     * the loop notice goes last, closest to what the model is about to answer.
     */
    transformContext: composeContext([
      screenshotTrim(opts.workspaceRoot),
      withinTurnFold({ summarize, contextWindow, overheadTokens, preservers }),
      injectContextBlocks(blocks),
      (messages) => injectSystemReminder(messages, currentDateNote(new Date()), { anchor: 'last' }),
      loop.transform,
    ]),
    prepareNextTurnWithContext: async ({ message, context }) => {
      loop.observe(message);
      return { context: { ...context, tools: toolsForNextTurn() } };
    },
    // A parked call ends the turn: the rest of its batch still runs, but nothing
    // new is asked of the model until the user has answered.
    shouldStopAfterTurn: () => ++turns >= MAX_TURNS || parked.size > 0,
    beforeToolCall: async ({ toolCall, args }) => {
      const park = (approvalId?: string) => {
        parked.set(toolCall.id, { toolCallId: toolCall.id, toolName: toolCall.name, approvalId });
        return { block: true, terminate: true, reason: AWAITING_USER };
      };
      // A client-side tool is answered by the user, never executed.
      if (clientSide.has(toolCall.name)) return park();
      if (!(await gate(toolCall.name, args, toolCall.id))) return undefined;
      const approvalId = randomUUID();
      opts.emit({ type: 'approval_requested', approvalId, toolCallId: toolCall.id });
      return park(approvalId);
    },
  });

  // pi owns the run's abort signal, so the turn's signal is forwarded to it.
  const stopRun = () => agent.abort();
  opts.abortSignal?.addEventListener('abort', stopRun, { once: true });

  agent.subscribe((event: AgentEvent) => {
    // The run emits its own agent_end once its bookkeeping is done, so that the
    // wire's promise — agent_end is the last event — stays literally true.
    if (event.type === 'agent_end') return;
    const projected = projectAgentEvent(event, opts.runId);
    if (!projected) return;
    // pi announces every appended message; only assistant turns belong on the
    // wire — tool results arrive as tool_execution_end, and the user's message
    // is what started the run.
    if (
      (projected.type === 'message_start' || projected.type === 'message_end') &&
      projected.message.role !== 'assistant'
    ) {
      return;
    }
    if (projected.type === 'tool_execution_end') {
      // A parked call produced no result — the card is showing the ask, and a
      // refusal frame would replace it with an error the user never caused.
      if (parked.has(projected.toolCallId)) return;
      projected.result.details = withErrorText(
        projected.result.details,
        projected.result.content,
        projected.isError,
      );
    }
    opts.emit(projected);
  });

  agent.subscribe((event: AgentEvent) => {
    if (event.type !== 'message_end') return;
    const message = storedMessage(event.message);
    if (isAssistant(message)) {
      // A provider failure ends the turn as an errored assistant message rather
      // than an exception, so this is the only place a headless caller can learn
      // the run failed.
      if (message.stopReason === 'error') failure = message.errorMessage ?? 'the model call failed';
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
      // Same for storage: a parked call is stored as still open, so a reload
      // shows the ask again and the decision can still land on it.
      if (parked.has(message.toolCallId)) return;
      message.details = withErrorText(message.details, message.content, message.isError);
      rows.push({ id: message.toolCallId, role: 'toolResult', message });
    }
  });

  opts.emit({ type: 'notice', name: 'message-metadata', payload: { createdAt: openedAt } });

  try {
    await agent.continue();
  } catch (err) {
    // pi encodes model failures in the stream; reaching here means the loop
    // itself broke, and the renderer needs to hear about it.
    log.warn(`run failed: ${err}`);
    failure = err instanceof Error ? err.message : String(err);
    opts.emit({
      type: 'notice',
      name: 'stream-error',
      payload: { errorText: failure },
    });
  } finally {
    opts.abortSignal?.removeEventListener('abort', stopRun);
  }

  const aborted = opts.abortSignal?.aborted ?? false;
  const metadata = {
    createdAt: openedAt,
    durationMs: Date.now() - openedAt,
    providerId: opts.providerId,
    modelId: opts.modelId,
    inputTokens: (prior.inputTokens ?? 0) + totals.input,
    outputTokens: (prior.outputTokens ?? 0) + totals.output,
    cacheReadTokens: (prior.cacheReadTokens ?? 0) + totals.cacheRead,
    cacheCreationTokens: (prior.cacheCreationTokens ?? 0) + totals.cacheWrite,
    totalTokens: (prior.totalTokens ?? 0) + totals.total,
    contextTokens: contextTokens ?? prior.contextTokens,
  };
  opts.emit({ type: 'notice', name: 'message-metadata', payload: metadata });

  if (rows.length > 0) {
    stampParkedCalls(rows, parked);
    sealUnansweredCalls(rows, parked);
    rows[0].metadata = { ...rows[0].metadata, ...metadata };
    opts.persist(rows, { markRead: aborted });
    opts.recordUsage?.({
      messageId: opts.runId,
      providerId: opts.providerId,
      modelId: opts.modelId,
      inputTokens: totals.input,
      outputTokens: totals.output,
      cacheReadTokens: totals.cacheRead,
      cacheCreationTokens: totals.cacheWrite,
      totalTokens: totals.total,
    });
  }

  await recordTurn(opts.workspaceRoot, opts.threadId);
  opts.emit({ type: 'agent_end', willRetry: false });
  opts.onSettled?.();

  // A stop is the user's doing, not a failure — only a real error is reported.
  return {
    status: failure && !aborted ? 'error' : 'ok',
    error: aborted ? undefined : failure,
    stored: rows.length > 0,
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
