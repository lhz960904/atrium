import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { createSessionRecorder, type SessionRecorder } from '@main/conversation/session-recorder';
import {
  compactThread,
  openThreadSession,
  resolveThreadWorkspace,
  runnableHistory,
  setThreadTitle,
  touchThread,
} from '@main/conversation/threads';
import { generateThreadTitle } from '@main/conversation/title';
import { splitUserMessage } from '@main/conversation/ui-messages';
import type { Db } from '@main/db';
import { recordUsage } from '@main/db/usage';
import { type ComputerUseHelper, getComputerUseHelper } from '@main/platform/computer-use';
import { getSettings } from '@main/settings/conf';
import { createLogger } from '@main/utils/log';
import type { AtriumUIMessage } from '@shared/chat';
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { AgentSessionEvent, RunCompletion } from '@shared/protocol';
import { compactForTurn } from '../context/compaction';
import { loadContextBlocks } from '../context/injectors';
import { createSummarizer } from '../context/summarize';
import { estimateTokens } from '../context/tokens';
import { mcpManager } from '../mcp/manager';
import { buildMcpTools } from '../mcp/tool-adapter';
import { recordTurn } from '../memory/state';
import { approvalGate } from '../permissions';
import { readSoul } from '../profile/paths';
import { buildSystemPrompt } from '../prompts';
import { modelRates, resolvePiModel, supportsImageToolResults } from '../providers/models';
import { piStreamFn } from '../providers/registry';
import { type BackgroundShells, LocalSandbox } from '../sandbox';
import { getSkills } from '../skills/registry';
import { getTools } from '../tools';
import { preserveActiveSkill } from '../tools/builtins/skill';
import { preserveTodos } from '../tools/builtins/todo';
import { createAgentLoop } from './agent-loop';
import { composeCapabilities } from './capabilities/compose';
import {
  contextCompaction,
  contextInjection,
  dateReminder,
  screenshotContext,
} from './capabilities/context';
import { loopDetection } from './capabilities/loop-detection';
import { skillToolScope } from './capabilities/skill-tool-scope';
import { toolInteractions } from './capabilities/tool-interactions';
import { type PendingInteractions, stopReasonOf } from './pending-interactions';
import type { RunContext } from './run-context';
import { projectAgentEvent } from './stream/projector';

const log = createLogger('agent');
const preservers = [preserveTodos, preserveActiveSkill];

/** Business input, independent of the resources assembled for its execution. */
export type RunInput = {
  threadId: string;
  permissionMode?: PermissionMode;
  userMessage?: AtriumUIMessage;
};

export type RunResult = {
  runId: string;
  /** The UI message id, not an individual pi entry id. */
  messageId?: string;
} & ({ status: 'completed' | 'aborted'; error?: never } | { status: 'failed'; error: string });

export type ExecuteRunOptions = {
  input: RunInput;
  runId: string;
  /** Resolved at admission so an unknown model still fails start() synchronously. */
  model: Model<Api>;
  db: Db;
  projectlessRoot: string;
  bgShells: BackgroundShells;
  signal: AbortSignal;
  /** Decisions reach the calls waiting in this run through it; created with the run's controller. */
  pending: PendingInteractions;
  emit: (event: AgentSessionEvent) => void;
};

/**
 * Execute a run to its end; waiting on the user happens inside it. Owns the
 * whole per-execution lifecycle; Runner only owns admission, cancellation and
 * streams.
 */
export async function executeRun(opts: ExecuteRunOptions): Promise<RunResult> {
  const { input, runId, model, db, signal, emit } = opts;
  let recorder: SessionRecorder | undefined;
  let openedAt = Date.now();
  let workspaceRoot: string | undefined;
  let computerUse: ComputerUseHelper | undefined;
  let finished = false;
  let result: RunResult = { runId, status: 'completed' };

  // Keep the original failure when bookkeeping or cleanup fails afterwards.
  const fail = (error: unknown) => {
    const errorText = error instanceof Error ? error.message : String(error);
    log.warn(`run ${runId} failed: ${errorText}`);
    if (result.status === 'failed') return;
    const failure = opts.pending.failure;
    result = failure
      ? { runId, status: 'failed', error: failure.message }
      : signal.aborted
        ? { runId, status: 'aborted' }
        : { runId, status: 'failed', error: errorText };
  };

  try {
    // First on the stream, before anything can await: a reader that replays from
    // the start always learns which run it is reading.
    emit({ type: 'run_started', runId });
    signal.throwIfAborted();
    workspaceRoot = resolveThreadWorkspace(db, input.threadId, opts.projectlessRoot);
    computerUse =
      process.platform === 'darwin' && getSettings('computerUse.enabled')
        ? getComputerUseHelper()
        : undefined;

    const session = await openThreadSession(db, input.threadId, workspaceRoot);
    recorder = createSessionRecorder({ session, runId });
    const prompt = input.userMessage
      ? { id: input.userMessage.id, message: splitUserMessage(input.userMessage).message }
      : undefined;
    await recorder.begin(prompt);
    touchThread(db, input.threadId, { markRead: prompt !== undefined });
    const [started] = await session.findRecords({ type: 'operation_started', runId, limit: 1 });
    openedAt = started?.timestamp ?? openedAt;
    emit({ type: 'notice', name: 'message-metadata', payload: { createdAt: openedAt } });

    const prepared = await prepareRun(opts, workspaceRoot, computerUse, recorder);
    const history = runnableHistory(await session.findEntriesOnBranch({ order: 'oldestFirst' }));
    if (getSettings('general.autoGenerateTitle')) {
      generateThreadTitle({
        messages: history,
        model,
        onTitle: (title) => {
          setThreadTitle(db, input.threadId, title);
          // A title may finish after the run; save it but never reopen its stream.
          if (!finished) emit({ type: 'notice', name: 'title', payload: { data: { title } } });
        },
      });
    }
    const messages = await prepareMessages(opts, prepared, history);
    const { ctx, tools, blocks, summarize, interactions } = prepared;

    // One explicit registration area. Order matters within each pi hook.
    const capabilities = [
      screenshotContext(workspaceRoot),
      contextCompaction({
        summarize,
        contextWindow: model.contextWindow,
        overheadTokens: estimateTokens(blocks.join('\n')),
        preservers,
      }),
      contextInjection(blocks),
      dateReminder(),
      skillToolScope(tools, ctx.scratch),
      loopDetection(),
      interactions,
    ];
    const loop = createAgentLoop({
      systemPrompt: ctx.system,
      model,
      streamFn: piStreamFn,
      messages,
      tools,
      maxTurns: 100,
      ...composeCapabilities(capabilities),
    });
    loop.subscribe((event) => {
      const projected = projectAgentEvent(event);
      if (projected) emit(projected);
    });
    // Notify readers first, then await persistence before the loop continues.
    loop.subscribe(recorder.observe);
    await loop.run(signal);

    // A recording failure during a wait stops the run through its signal, so it
    // is checked before the signal is read as a cancellation.
    result = opts.pending.failure
      ? { runId, status: 'failed', error: opts.pending.failure.message }
      : signal.aborted
        ? { runId, status: 'aborted' }
        : recorder.failure
          ? { runId, status: 'failed', error: recorder.failure }
          : { runId, status: 'completed' };
  } catch (error) {
    fail(error);
  }

  // Each mandatory cleanup still runs if an earlier one failed. No resource or
  // recording lifecycle crosses back into Runner through a callback.
  try {
    if (recorder) reportUsage(opts, recorder, openedAt);
  } catch (error) {
    fail(error);
  }
  try {
    computerUse?.hideOverlay();
  } catch (error) {
    fail(error);
  }
  try {
    // The recorder repairs what an interrupted run left behind, so it needs the
    // reason the run actually stopped for.
    await recorder?.end(result.status, stopReasonOf(signal.reason));
  } catch (error) {
    fail(error);
  }
  opts.pending.dispose();
  if (workspaceRoot && recorder?.messageId) await recordTurn(workspaceRoot, input.threadId);
  finished = true;
  emit({ type: 'run_finished', ...toRunCompletion(result, signal.reason) });
  return { ...result, messageId: recorder?.messageId };
}

/** The outcome as the wire states it; only a stop reason the run knows is kept. */
function toRunCompletion(result: RunResult, reason: unknown): RunCompletion {
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  if (result.status === 'aborted') return { status: 'aborted', reason: stopReasonOf(reason) };
  return { status: 'completed' };
}

/** Context and tools are built together, not via a callback into Runner. */
async function prepareRun(
  opts: ExecuteRunOptions,
  workspaceRoot: string,
  computerUse: ComputerUseHelper | undefined,
  recorder: SessionRecorder,
) {
  opts.signal.throwIfAborted();
  const { input, db, model, signal } = opts;
  const sandbox = new LocalSandbox(workspaceRoot);
  const skills = getSkills();
  const mode = input.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const ctx: RunContext = {
    threadId: input.threadId,
    db,
    sandbox,
    workspaceRoot,
    system: buildSystemPrompt(workspaceRoot, {
      soul: await readSoul(),
      platform: process.platform,
      mode,
    }),
    providerId: model.provider,
    modelId: model.id,
    notice: (name, data) => opts.emit({ type: 'notice', name, payload: { data } }),
    scratch: new Map(),
  };
  const gate = approvalGate({
    mode,
    rules: getSettings('permissions.trustRules'),
    reviewerModel: mode === 'auto-review' ? resolveReviewer(db, model) : undefined,
    workspaceRoot,
    abortSignal: signal,
    onReviewed: ({ toolCallId, subject }) => ctx.notice('autoReview', { toolCallId, subject }),
  });
  const interactions = toolInteractions({
    gate,
    pending: opts.pending,
    recorder,
    emit: opts.emit,
    signal,
  });
  const supportsImages = supportsImageToolResults(model);
  const tools = getTools({
    sandbox,
    workspaceRoot,
    run: ctx,
    ask: interactions.ask,
    skills,
    engine: { model, streamFn: piStreamFn },
    bgShells: opts.bgShells,
    supportsImageToolResults: supportsImages,
    computerUse,
    mcpTools: buildMcpTools(mcpManager.catalog(), mcpManager, {
      supportsImageToolResults: supportsImages,
      workspaceRoot,
    }),
  });
  const blocks = await loadContextBlocks({ skills, workspaceRoot });
  return { ctx, tools, blocks, interactions, summarize: createSummarizer(model) };
}

async function prepareMessages(
  opts: ExecuteRunOptions,
  prepared: Awaited<ReturnType<typeof prepareRun>>,
  history: Message[],
): Promise<Message[]> {
  opts.signal.throwIfAborted();
  const compacted = await compactForTurn({
    messages: history,
    summarize: prepared.summarize,
    contextWindow: opts.model.contextWindow,
    preservers,
    emit: (phase) => prepared.ctx.notice('compaction', { phase }),
    persist: (fold) => compactThread(opts.db, opts.input.threadId, fold),
  });
  return compacted;
}

/** Resolve auto-review only when enabled; an invalid setting falls back to asking. */
function resolveReviewer(db: Db, fallback: Model<Api>): Model<Api> | undefined {
  const configured = getSettings('permissions.reviewerModel');
  if (!configured) return fallback;
  try {
    return resolvePiModel(db, configured.providerId, configured.modelId);
  } catch (error) {
    log.info(`reviewer unresolved → prompts: ${error}`);
    return undefined;
  }
}

function reportUsage(opts: ExecuteRunOptions, recorder: SessionRecorder, openedAt: number): void {
  const totals = recorder.totals;
  const usage = {
    providerId: opts.model.provider,
    modelId: opts.model.id,
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheReadTokens: totals.cacheRead,
    cacheCreationTokens: totals.cacheWrite,
    totalTokens: totals.total,
  };
  opts.emit({
    type: 'notice',
    name: 'message-metadata',
    payload: {
      createdAt: openedAt,
      durationMs: Date.now() - openedAt,
      contextTokens: recorder.contextTokens,
      ...usage,
    },
  });
  if (recorder.wrote) {
    recordUsage(
      opts.db,
      { ...usage, threadId: opts.input.threadId, messageId: opts.runId, kind: 'chat' },
      modelRates(opts.model),
    );
  }
}
