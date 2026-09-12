import { randomUUID } from 'node:crypto';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import { createLogger } from '@main/log';
import type { RunJournal } from '@main/session/journal';
import type { PermissionMode } from '@shared/permissions';
import type { AgentSessionEvent, Message } from '@shared/protocol';
import { recordTurn } from '../memory/state';
import { type ApprovalContext, approvalGate } from '../permissions';
import { readSoul } from '../profile/paths';
import { buildSystemPrompt } from '../prompts';
import type { Sandbox } from '../sandbox/types';
import { type ActiveSkill, SKILL_SCRATCH_KEY, type Skill } from '../skills/types';
import type { AtriumTool } from '../tools';
import { preserveActiveSkill } from '../tools/builtins/skill';
import { preserveTodos } from '../tools/builtins/todo';
import { applyResolutions, type ParkedCall, type Resolution } from './approvals';
import { compactForTurn, type Fold, withinTurnFold } from './compaction';
import { type Complete, createCompleter } from './complete';
import { injectContextBlocks, loadContextBlocks } from './context/injectors';
import { screenshotTrim } from './context/screenshot-trim';
import { withSettledResults } from './history';
import { createAgentLoop } from './loop';
import type { RunContext } from './run-context';
import { wireEmitter } from './stream/emitter';
import { summarizerFrom } from './summarize';
import { estimateTokens } from './tokens';
import { scopeToolsToSkill } from './tool-scope';

const log = createLogger('agent');

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
  /** Where the run's events go — the thread's envelope log. */
  emit: (event: AgentSessionEvent) => void;
  /** Where the run's messages go, as they land. Injected so the agent layer
   *  stays independent of how a conversation is stored. */
  journal: RunJournal;
  /** When the run first started, for a continuation that reports itself again. */
  openedAt?: number;
  /**
   * Record a cross-turn fold. Folding only runs when this is supplied: a summary
   * nobody stores would be paid for again on every turn.
   */
  persistCheckpoint?: (fold: Fold) => Promise<void> | void;
  /** Append the turn to the usage ledger. */
  recordUsage?: (usage: RunUsage) => void;
  /** Summarize the thread's opening message into a title (fire-and-forget). */
  generateTitle?: (input: { messages: Message[]; complete: Complete }) => void;
  abortSignal?: AbortSignal;
  /** Fires once when the turn settles (finished or aborted) — e.g. to collapse UI the run left on screen. */
  onSettled?: () => void;
};

/** What the model is told about a call it will not get a result for this turn. */
const AWAITING_USER = 'Paused: waiting for the user. The turn ends here.';

/**
 * One chat turn. The engine loop, the context it runs on and the two readers of
 * its events — one projecting onto the wire, one accumulating the rows to store
 * — are each their own piece; this assembles them and settles the bookkeeping
 * once the loop is done.
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
    notice: (name, data) => opts.emit({ type: 'notice', name, payload: { data } }),
    scratch: new Map(),
  };

  const tools = opts.buildTools(ctx);
  // A client-side tool is answered by the user, never executed.
  const clientSide = new Set(tools.filter((t) => t.clientSide).map((t) => t.name));

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

  const compacted = opts.persistCheckpoint
    ? await compactForTurn({
        messages: opts.messages,
        summarize,
        contextWindow,
        preservers,
        emit: (phase) => ctx.notice('compaction', { phase }),
        persist: opts.persistCheckpoint,
      })
    : opts.messages;

  // Settle what the user decided before the loop sees the transcript: a parked
  // call has no result yet, and the engine will not run a call from a turn that
  // has already ended.
  const settled = await applyResolutions({
    resolutions: opts.resolutions ?? [],
    messages: compacted,
    tools,
    emit: opts.emit,
    abortSignal: opts.abortSignal,
  });
  const messages = withSettledResults(compacted, settled);

  /** Calls this turn handed back to the user; they end it and stay open. */
  const parked = new Map<string, ParkedCall>();
  const gate = approvalGate({
    ...opts.permission,
    workspaceRoot: opts.workspaceRoot,
    abortSignal: opts.abortSignal,
    onReviewed: ({ toolCallId, subject }) => ctx.notice('autoReview', { toolCallId, subject }),
  });

  // A continuation keeps the run's original start, so the card it extends does
  // not appear to have begun again.
  const openedAt = opts.openedAt ?? startedAt;
  // The results the user's decisions produced belong to the run too — they are
  // what the loop is about to continue from.
  for (const message of settled) {
    await opts.journal.observe({ type: 'message_end', message } as never);
  }

  const loop = createAgentLoop({
    systemPrompt: ctx.system,
    model: opts.piModel,
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
    messages,
    tools,
    /**
     * Everything the model sees beyond the stored transcript, rebuilt for each
     * request and thrown away after it. Order is the contract: the trim runs
     * first so the fold measures the smaller view, and the fold before the
     * standing blocks so it can never summarize them away; the blocks then land
     * on the first user turn, so they ride inside the cached prefix.
     */
    transforms: [
      screenshotTrim(opts.workspaceRoot),
      withinTurnFold({ summarize, contextWindow, overheadTokens, preservers }),
      injectContextBlocks(blocks),
    ],
    // The active skill decides how wide the offered set is; recomputed from the
    // full set each turn so a narrowing can never compound.
    toolsForNextTurn: () =>
      scopeToolsToSkill(tools, ctx.scratch.get(SKILL_SCRATCH_KEY) as ActiveSkill | undefined),
    // A parked call ends the turn: the rest of its batch still runs, but nothing
    // new is asked of the model until the user has answered.
    stopAfterTurn: () => parked.size > 0,
    beforeToolCall: async ({ toolCall, args }) => {
      const park = async (approvalId?: string) => {
        parked.set(toolCall.id, { toolCallId: toolCall.id, toolName: toolCall.name, approvalId });
        await opts.journal.park({ toolCallId: toolCall.id, approvalId });
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

  loop.subscribe(wireEmitter({ runId: opts.runId, parked, emit: opts.emit }));
  // Second, so a reader sees the turn as soon as it lands while the loop still
  // waits for it to be stored before going on.
  loop.subscribe(opts.journal.observe);

  opts.emit({ type: 'notice', name: 'message-metadata', payload: { createdAt: openedAt } });

  let loopError: string | undefined;
  try {
    await loop.run(opts.abortSignal);
  } catch (err) {
    // pi encodes model failures in the stream; reaching here means the loop
    // itself broke, and the renderer needs to hear about it.
    log.warn(`run failed: ${err}`);
    loopError = err instanceof Error ? err.message : String(err);
    opts.emit({ type: 'notice', name: 'stream-error', payload: { errorText: loopError } });
  }

  const aborted = opts.abortSignal?.aborted ?? false;
  const totals = opts.journal.totals;
  // The live figures the card shows while the turn is open. What gets stored is
  // the usage records the journal already wrote; this is the wire's copy.
  opts.emit({
    type: 'notice',
    name: 'message-metadata',
    payload: {
      createdAt: openedAt,
      durationMs: Date.now() - openedAt,
      providerId: opts.providerId,
      modelId: opts.modelId,
      inputTokens: totals.input,
      outputTokens: totals.output,
      cacheReadTokens: totals.cacheRead,
      cacheCreationTokens: totals.cacheWrite,
      totalTokens: totals.total,
      contextTokens: opts.journal.contextTokens,
    },
  });

  // A stop is the user's doing, not a failure — only a real error is reported.
  const failure = loopError ?? opts.journal.failure;
  // A run holding a parked call is not over: its bracket stays open so the
  // decision, whenever it arrives, extends this same run.
  if (parked.size === 0) {
    await opts.journal.end(aborted ? 'aborted' : failure ? 'failed' : 'completed');
  }

  if (opts.journal.wrote) {
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

  return {
    status: failure && !aborted ? 'error' : 'ok',
    error: aborted ? undefined : failure,
    stored: opts.journal.wrote,
  };
}
