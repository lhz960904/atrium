import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { getAgentMessages } from '@main/conversation/project';
import { createSessionRecorder, type SessionRecorder } from '@main/conversation/session-recorder';
import { conversations } from '@main/conversation/store/session';
import {
  compactThread,
  resolveThreadWorkspace,
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
import { compactForTurn, contextCompaction } from '../context/compaction';
import { contextInjection, loadContextBlocks } from '../context/injectors';
import { screenshotContext } from '../context/screenshot-trim';
import { createSummarizer } from '../context/summarize';
import { dateReminder } from '../context/system-reminder';
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
import { skillToolScope } from '../skills/scope';
import { getTools } from '../tools';
import { preserveActiveSkill } from '../tools/builtins/skill';
import { preserveTodos } from '../tools/builtins/todo';
import { toolInteractions } from '../tools/interactions';
import { loopDetection } from '../tools/loop-detection';
import { createAgentLoop } from './agent-loop';
import { composeHooks } from './hook-compose';
import { type PendingInteractions, stopReasonOf } from './pending-interactions';
import type { RunContext } from './run-context';
import { convertAgentSessionEvent } from './stream/convert';

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
  defaultProjectRoot: string;
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
  return new RunExecution(opts).execute();
}

/** What a run assembles as it goes, so each step can be read on its own. */
class RunExecution {
  private recorder: SessionRecorder | undefined;
  private workspaceRoot: string | undefined;
  private computerUse: ComputerUseHelper | undefined;
  private openedAt = Date.now();
  private finished = false;
  private result: RunResult;

  constructor(private readonly opts: ExecuteRunOptions) {
    this.result = { runId: opts.runId, status: 'completed' };
  }

  async execute(): Promise<RunResult> {
    const { runId, signal } = this.opts;
    try {
      // First on the stream, before anything can await: a reader that replays
      // from the start always learns which run it is reading.
      this.opts.emit({ type: 'run_started', runId });
      signal.throwIfAborted();

      const { conversation, recorder, workspaceRoot } = await this.open();
      const prepared = await this.prepare(workspaceRoot, recorder);
      const history = getAgentMessages(await conversation.entries());
      if (getSettings('general.autoGenerateTitle')) this.startTitle(history);
      const messages = await this.foldForTurn(prepared, history);

      const loop = this.buildLoop(prepared, messages, recorder);
      await loop.run(signal);
      this.result = this.settle();
    } catch (error) {
      this.fail(error);
    }
    // What the conversation did, captured before cleanup can overwrite it: a
    // failed usage write says nothing about how the turn itself ended, and must
    // not record a finished conversation as one that stopped.
    await this.close(this.result.status);
    return { ...this.result, messageId: this.recorder?.messageId };
  }

  /**
   * What the run amounts to as it stands. A failure the run itself recorded
   * outranks a stop, because a recording failure during a wait is what stopped
   * the run in the first place; a stop outranks a failed turn, which the user
   * asked to abandon. `errorText` is what threw, used only when none of those
   * already explain the outcome.
   */
  private settle(errorText?: string): RunResult {
    const { runId, pending, signal } = this.opts;
    if (pending.failure) return { runId, status: 'failed', error: pending.failure.message };
    if (signal.aborted) return { runId, status: 'aborted' };
    if (this.recorder?.failure) {
      return { runId, status: 'failed', error: this.recorder.failure };
    }
    return errorText === undefined
      ? { runId, status: 'completed' }
      : { runId, status: 'failed', error: errorText };
  }

  /** Keep the original failure when bookkeeping or cleanup fails afterwards. */
  private fail(error: unknown): void {
    const errorText = error instanceof Error ? error.message : String(error);
    log.warn(`run ${this.opts.runId} failed: ${errorText}`);
    if (this.result.status === 'failed') return;
    this.result = this.settle(errorText);
  }

  /** One cleanup step, whose failure must not stop the ones after it. */
  private async attempt(step: () => void | Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Open the thread's session and the record bracketing this run. What it built
   * is returned as well as kept, so the steps after it need no null checks for
   * state that only exists once this has run.
   */
  private async open() {
    const { input, db, runId } = this.opts;
    const workspaceRoot = resolveThreadWorkspace(db, input.threadId, this.opts.defaultProjectRoot);
    this.workspaceRoot = workspaceRoot;
    this.computerUse =
      process.platform === 'darwin' && getSettings('computerUse.enabled')
        ? getComputerUseHelper()
        : undefined;

    const conversation = await conversations().openForThread(input.threadId, workspaceRoot);
    const recorder = createSessionRecorder({ conversation, runId });
    this.recorder = recorder;
    const prompt = input.userMessage
      ? { id: input.userMessage.id, message: splitUserMessage(input.userMessage) }
      : undefined;
    await recorder.begin(prompt);
    touchThread(db, input.threadId, { markRead: prompt !== undefined });
    this.openedAt = (await conversation.runStartedAt(runId)) ?? this.openedAt;
    this.opts.emit({
      type: 'notice',
      name: 'message-metadata',
      payload: { createdAt: this.openedAt },
    });
    return { conversation, recorder, workspaceRoot };
  }

  /** A title may finish after the run; save it but never reopen its stream. */
  private startTitle(history: Message[]): void {
    const { db, input, model } = this.opts;
    generateThreadTitle({
      messages: history,
      model,
      onTitle: (title) => {
        setThreadTitle(db, input.threadId, title);
        if (!this.finished) {
          this.opts.emit({ type: 'notice', name: 'title', payload: { data: { title } } });
        }
      },
    });
  }

  /** Context and tools are built together, not via a callback into Runner. */
  private async prepare(workspaceRoot: string, recorder: SessionRecorder) {
    const { input, db, model, signal } = this.opts;
    signal.throwIfAborted();
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
      notice: (name, data) => this.opts.emit({ type: 'notice', name, payload: { data } }),
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
      pending: this.opts.pending,
      recorder,
      emit: this.opts.emit,
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
      bgShells: this.opts.bgShells,
      supportsImageToolResults: supportsImages,
      computerUse: this.computerUse,
      mcpTools: buildMcpTools(mcpManager.catalog(), mcpManager, {
        supportsImageToolResults: supportsImages,
        workspaceRoot,
      }),
    });
    const blocks = await loadContextBlocks({ skills, workspaceRoot });
    return { ctx, tools, blocks, interactions, summarize: createSummarizer(model) };
  }

  private async foldForTurn(
    prepared: Awaited<ReturnType<RunExecution['prepare']>>,
    history: Message[],
  ): Promise<Message[]> {
    const { db, input, model, signal } = this.opts;
    signal.throwIfAborted();
    return compactForTurn({
      messages: history,
      summarize: prepared.summarize,
      contextWindow: model.contextWindow,
      preservers,
      emit: (phase) => prepared.ctx.notice('compaction', { phase }),
      persist: (fold) => compactThread(db, input.threadId, fold),
    });
  }

  /** One explicit hook registration area, and the run's two event sinks. */
  private buildLoop(
    prepared: Awaited<ReturnType<RunExecution['prepare']>>,
    messages: Message[],
    recorder: SessionRecorder,
  ): ReturnType<typeof createAgentLoop> {
    const { model } = this.opts;
    const { ctx, tools, blocks, summarize, interactions } = prepared;
    // Order matters within each pi hook.
    const hooks = [
      screenshotContext(ctx.workspaceRoot),
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
      ...composeHooks(hooks),
    });
    loop.subscribe((event) => {
      const converted = convertAgentSessionEvent(event);
      if (converted) this.opts.emit(converted);
    });
    // Notify readers first, then await persistence before the loop continues.
    loop.subscribe(recorder.observe);
    return loop;
  }

  /**
   * Each mandatory cleanup still runs if an earlier one failed. No resource or
   * recording lifecycle crosses back into Runner through a callback.
   */
  private async close(outcome: RunResult['status']): Promise<void> {
    const { input, pending, signal } = this.opts;
    await this.attempt(() => this.reportUsage());
    await this.attempt(() => this.computerUse?.hideOverlay());
    // The recorder repairs what an interrupted run left behind, so it needs the
    // reason the run actually stopped for.
    await this.attempt(() => this.recorder?.end(outcome, stopReasonOf(signal.reason)));
    pending.dispose();
    if (this.workspaceRoot && this.recorder?.messageId) {
      await recordTurn(this.workspaceRoot, input.threadId);
    }
    this.finished = true;
    this.opts.emit({ type: 'run_finished', ...toRunCompletion(this.result, signal.reason) });
  }

  /**
   * What the reader cannot work out for itself. Token counts and the model ride
   * on every turn it already receives, so only the run's own timing is sent;
   * the ledger below is a separate concern from what the message displays.
   */
  private reportUsage(): void {
    const { db, input, model, runId } = this.opts;
    if (!this.recorder) return;
    const totals = this.recorder.totals;
    const usage = {
      providerId: model.provider,
      modelId: model.id,
      inputTokens: totals.input,
      outputTokens: totals.output,
      cacheReadTokens: totals.cacheRead,
      cacheCreationTokens: totals.cacheWrite,
      totalTokens: totals.total,
    };
    this.opts.emit({
      type: 'notice',
      name: 'message-metadata',
      payload: { createdAt: this.openedAt, durationMs: Date.now() - this.openedAt },
    });
    if (this.recorder.wrote) {
      recordUsage(
        db,
        { ...usage, threadId: input.threadId, messageId: runId, kind: 'chat' },
        modelRates(model),
      );
    }
  }
}

/** The outcome as the wire states it; only a stop reason the run knows is kept. */
function toRunCompletion(result: RunResult, reason: unknown): RunCompletion {
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  if (result.status === 'aborted') return { status: 'aborted', reason: stopReasonOf(reason) };
  return { status: 'completed' };
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
