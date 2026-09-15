import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { withSettledResults } from '@main/conversation/history';
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
import type { AgentSessionEvent } from '@shared/protocol';
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
import type { RunContext } from './run-context';
import { createRunEventProjector } from './stream/event-projector';
import { applyResolutions, type ParkedCall, type Resolution } from './tool-resolutions';

const log = createLogger('agent');
const preservers = [preserveTodos, preserveActiveSkill];

/** Business input, independent of the resources assembled for its execution. */
export type RunInput = {
  threadId: string;
  permissionMode?: PermissionMode;
  userMessage?: AtriumUIMessage;
  /** Continue this stored run instead of opening another one. */
  resumeRunId?: string;
  resolutions?: Resolution[];
};

export type RunResult = {
  runId: string;
  /** The UI message id, not an individual pi entry id. */
  messageId?: string;
} & (
  | { status: 'completed' | 'waiting' | 'aborted'; error?: never }
  | { status: 'failed'; error: string }
);

export type ExecuteRunOptions = {
  input: RunInput;
  runId: string;
  /** Resolved at admission so an unknown model still fails start() synchronously. */
  model: Model<Api>;
  db: Db;
  projectlessRoot: string;
  bgShells: BackgroundShells;
  signal: AbortSignal;
  emit: (event: AgentSessionEvent) => void;
};

/**
 * Execute until completion or a user interaction pauses the run. Owns the whole
 * per-execution lifecycle; Runner only owns admission, cancellation and streams.
 */
export async function executeRun(opts: ExecuteRunOptions): Promise<RunResult> {
  const { input, runId, model, db, signal, emit } = opts;
  const parked = new Map<string, ParkedCall>();
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
    result = signal.aborted
      ? { runId, status: 'aborted' }
      : { runId, status: 'failed', error: errorText };
  };

  try {
    signal.throwIfAborted();
    workspaceRoot = resolveThreadWorkspace(db, input.threadId, opts.projectlessRoot);
    computerUse =
      process.platform === 'darwin' && getSettings('computerUse.enabled')
        ? getComputerUseHelper()
        : undefined;

    const session = await openThreadSession(db, input.threadId, workspaceRoot);
    recorder = createSessionRecorder({ session, runId, resuming: !!input.resumeRunId });
    const prompt = input.userMessage
      ? { id: input.userMessage.id, message: splitUserMessage(input.userMessage).message }
      : undefined;
    await recorder.begin(prompt);
    touchThread(db, input.threadId, { markRead: prompt !== undefined });
    const [started] = await session.findRecords({ type: 'operation_started', runId, limit: 1 });
    openedAt = started?.timestamp ?? openedAt;
    emit({ type: 'notice', name: 'message-metadata', payload: { createdAt: openedAt } });

    const prepared = await prepareRun(opts, workspaceRoot, computerUse);
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
    const messages = await prepareMessages(opts, prepared, history, recorder);
    const { ctx, tools, blocks, summarize, gate } = prepared;

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
      toolInteractions({
        clientSide: new Set(tools.filter((tool) => tool.clientSide).map((tool) => tool.name)),
        gate,
        recorder,
        parked,
        emit,
      }),
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
    loop.subscribe(createRunEventProjector({ runId, parked, emit }));
    // Notify readers first, then await persistence before the loop continues.
    loop.subscribe(recorder.observe);
    await loop.run(signal);

    result = signal.aborted
      ? { runId, status: 'aborted' }
      : recorder.failure
        ? { runId, status: 'failed', error: recorder.failure }
        : { runId, status: parked.size ? 'waiting' : 'completed' };
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
    if (result.status !== 'waiting') {
      await recorder?.end(result.status);
    }
  } catch (error) {
    fail(error);
  }
  if (workspaceRoot && recorder?.messageId) await recordTurn(workspaceRoot, input.threadId);
  if (result.status === 'failed') {
    emit({ type: 'notice', name: 'stream-error', payload: { errorText: result.error } });
  }
  finished = true;
  emit({ type: 'agent_end', willRetry: false });
  return { ...result, messageId: recorder?.messageId };
}

/** Context and tools are built together, not via a callback into Runner. */
async function prepareRun(
  opts: ExecuteRunOptions,
  workspaceRoot: string,
  computerUse: ComputerUseHelper | undefined,
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
  const supportsImages = supportsImageToolResults(model);
  const tools = getTools({
    sandbox,
    workspaceRoot,
    run: ctx,
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
  const gate = approvalGate({
    mode,
    rules: getSettings('permissions.trustRules'),
    reviewerModel: mode === 'auto-review' ? resolveReviewer(db, model) : undefined,
    workspaceRoot,
    abortSignal: signal,
    onReviewed: ({ toolCallId, subject }) => ctx.notice('autoReview', { toolCallId, subject }),
  });
  return { ctx, tools, blocks, gate, summarize: createSummarizer(model) };
}

async function prepareMessages(
  opts: ExecuteRunOptions,
  prepared: Awaited<ReturnType<typeof prepareRun>>,
  history: Message[],
  recorder: SessionRecorder,
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
  opts.signal.throwIfAborted();
  const settled = await applyResolutions({
    resolutions: opts.input.resolutions ?? [],
    messages: compacted,
    tools: prepared.tools,
    emit: opts.emit,
    abortSignal: opts.signal,
  });
  for (const message of settled) await recorder.observe({ type: 'message_end', message });
  return withSettledResults(compacted, settled);
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
