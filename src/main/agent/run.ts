import { Agent, type AgentEvent, type StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model, Message as PiMessage } from '@earendil-works/pi-ai';
import type { PermissionMode } from '@shared/permissions';
import type {
  AgentSessionEvent,
  AssistantMessage,
  Content,
  Message,
  ToolCall,
} from '@shared/protocol';
import type { LanguageModel, Tool, UIMessage } from 'ai';
import type { Db } from '../db';
import { createLogger } from '../log';
import { recordTurn } from './memory/state';
import type { RunContext } from './middleware';
import { type Checkpoint, compactForTurn, withinTurnFold } from './pi/compaction';
import { composeContext } from './pi/context';
import { injectSystemReminder } from './pi/history';
import { injectContextBlocks, loadContextBlocks } from './pi/injectors';
import { createLoopDetector } from './pi/loop-detection';
import { projectAgentEvent } from './pi/projector';
import { screenshotTrim } from './pi/screenshot-trim';
import { createSummarizer } from './pi/summarize';
import { estimateTokens } from './pi/tokens';
import { withErrorText } from './pi/tool-result';
import { scopeToolsToSkill } from './pi/tool-scope';
import { asPi, storedMessage } from './pi/vocabulary';
import { readSoul } from './profile/paths';
import { buildSystemPrompt, currentDateNote } from './prompts';
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
  /** The AI SDK handle for the paths that have not moved yet — the title call
   *  and the subagent's nested loop. Retires with them. */
  model: LanguageModel;
  /** The thread's transcript as pi messages: what the engine runs on. */
  messages: Message[];
  /** The same history as UIMessages, for the interim consumers that still read
   *  it (image_gen's reference images, the subagent). */
  uiMessages: UIMessage[];
  workspaceRoot: string;
  threadId: string;
  db: Db;
  sandbox: Sandbox;
  /** Discovered skills: their index rides in the model's context, and an active
   *  one narrows the tools offered on the turns that follow. */
  skills: Skill[];
  /** Built once the run context exists — the tools that reach back into the turn
   *  close over it. `aiSdk` is the same set adapted for the subagent's loop. */
  buildTools: (run: RunContext) => { tools: AtriumTool[]; aiSdk: Record<string, Tool> };
  /** Active permission mode, surfaced in the system prompt so the model knows how approvals behave. */
  permissionMode: PermissionMode;
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
  generateTitle?: (ctx: RunContext) => void;
  /**
   * Whether a call crosses the workspace boundary and must therefore wait for
   * the user. It is refused rather than parked: the approve/deny round trip is
   * still being ported, and a boundary crossing that runs unasked is the one
   * outcome the permission modes exist to prevent.
   */
  guardToolCall?: (call: { name: string; input: unknown }) => boolean;
  abortSignal?: AbortSignal;
  /** Fires once when the turn settles (finished or aborted) — e.g. to collapse UI the run left on screen. */
  onSettled?: () => void;
};

/** Complex work routinely runs a dozen turns; this is the runaway brake. */
const MAX_TURNS = 100;

const NOT_YET_ASKABLE =
  'Asking the user through this tool is not wired up in this build. ' +
  'Ask your question in plain text instead and end your turn.';

const NEEDS_APPROVAL =
  "This call needs the user's approval, which this build cannot ask for yet. " +
  'Tell the user to switch the permission mode to full access, or to run it themselves.';

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
export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const soul = await readSoul();
  const startedAt = Date.now();
  // Files a tool produced mid-turn (image_gen). The wire gets them immediately
  // as notices; they join the turn's stored content so a reload still shows them.
  const files: Content[] = [];

  const ctx: RunContext = {
    threadId: opts.threadId,
    db: opts.db,
    sandbox: opts.sandbox,
    workspaceRoot: opts.workspaceRoot,
    request: {
      system: buildSystemPrompt(opts.workspaceRoot, {
        soul,
        platform: process.platform,
        mode: opts.permissionMode,
      }),
      messages: opts.uiMessages,
      tools: {},
    },
    model: opts.model,
    providerId: opts.providerId,
    modelId: opts.modelId,
    // Transient UI channels (a generated image, an auto-review badge, subagent
    // activity) still speak in stream chunks; they ride the wire as notices,
    // which is exactly what the renderer's notice router already expects.
    emit: (chunk) => {
      const c = chunk as { type: string; url?: string; mediaType?: string };
      if (c.type === 'file') {
        const content: Content = { type: 'file', url: c.url, mediaType: c.mediaType } as Content;
        files.push(content);
        opts.emit({
          type: 'notice',
          name: 'file',
          payload: { url: c.url, mediaType: c.mediaType },
        });
        return;
      }
      if (!c.type.startsWith('data-')) return;
      const { type, ...payload } = chunk as { type: string; [key: string]: unknown };
      opts.emit({ type: 'notice', name: type.slice('data-'.length), payload });
    },
    scratch: new Map(),
  };

  const built = opts.buildTools(ctx);
  // A client-side tool is answered by the user, never executed. Until that
  // round trip is ported, the engine must not call it — it would throw.
  const clientSide = new Set(built.tools.filter((t) => t.clientSide).map((t) => t.name));
  ctx.request.tools = built.aiSdk;
  opts.generateTitle?.(ctx);

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
  const summarize = createSummarizer({
    model: opts.piModel,
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
  });
  const announceCompaction = (phase: 'start' | 'done'): void =>
    ctx.emit({ type: 'data-compaction', data: { phase }, transient: true });

  const messages = opts.persistCheckpoint
    ? await compactForTurn({
        messages: opts.messages,
        summarize,
        contextWindow,
        preservers,
        emit: announceCompaction,
        persist: opts.persistCheckpoint,
      })
    : opts.messages;

  // A run that tripped the loop brake is offered nothing, so the model has to
  // answer in text; otherwise the active skill decides how wide the set is.
  const toolsForNextTurn = (): AtriumTool[] =>
    loop.stopped
      ? []
      : scopeToolsToSkill(
          built.tools,
          ctx.scratch.get(SKILL_SCRATCH_KEY) as ActiveSkill | undefined,
        );

  const rows: RunRow[] = [];
  let turns = 0;
  let contextTokens: number | undefined;
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

  const agent = new Agent({
    initialState: {
      systemPrompt: ctx.request.system,
      model: opts.piModel,
      tools: built.tools,
      messages: asPi(messages),
    },
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
    // Every message in the transcript is an LLM message today; the filter earns
    // its keep once compaction checkpoints land.
    convertToLlm: (messages) => messages as PiMessage[],
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
    shouldStopAfterTurn: () => ++turns >= MAX_TURNS,
    beforeToolCall: async ({ toolCall, args }) => {
      if (clientSide.has(toolCall.name)) {
        return { block: true, terminate: true, reason: NOT_YET_ASKABLE };
      }
      return opts.guardToolCall?.({ name: toolCall.name, input: args })
        ? { block: true, terminate: true, reason: NEEDS_APPROVAL }
        : undefined;
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
      rows.push({
        id: `${opts.runId}:${rows.filter((r) => r.role === 'assistant').length}`,
        role: 'assistant',
        message,
      });
      return;
    }
    if (message.role === 'toolResult') {
      message.details = withErrorText(message.details, message.content, message.isError);
      rows.push({ id: message.toolCallId, role: 'toolResult', message });
    }
  });

  opts.emit({ type: 'notice', name: 'message-metadata', payload: { createdAt: startedAt } });

  try {
    await agent.continue();
  } catch (err) {
    // pi encodes model failures in the stream; reaching here means the loop
    // itself broke, and the renderer needs to hear about it.
    log.warn(`run failed: ${err}`);
    opts.emit({
      type: 'notice',
      name: 'stream-error',
      payload: { errorText: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    opts.abortSignal?.removeEventListener('abort', stopRun);
  }

  const aborted = opts.abortSignal?.aborted ?? false;
  const metadata = {
    createdAt: startedAt,
    durationMs: Date.now() - startedAt,
    providerId: opts.providerId,
    modelId: opts.modelId,
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheReadTokens: totals.cacheRead,
    cacheCreationTokens: totals.cacheWrite,
    totalTokens: totals.total,
    contextTokens,
  };
  opts.emit({ type: 'notice', name: 'message-metadata', payload: metadata });

  if (rows.length > 0) {
    attachFiles(rows, files);
    sealUnansweredCalls(rows);
    rows[0].metadata = metadata;
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
}

const SEAL_ERROR = 'Stopped before the tool returned.';

/**
 * Give every tool call a result row. A stopped turn leaves its in-flight call
 * unanswered, and both the provider (which rejects an unpaired tool call in the
 * history) and the card (which would sit spinning forever) need it closed.
 */
function sealUnansweredCalls(rows: RunRow[]): void {
  const answered = new Set(rows.flatMap((row) => (row.role === 'toolResult' ? [row.id] : [])));
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

/** Fold tool-produced files into the run's last assistant turn, so they are
 *  stored on the message the way the renderer already shows them. */
function attachFiles(rows: RunRow[], files: Content[]): void {
  if (files.length === 0) return;
  for (let i = rows.length - 1; i >= 0; i--) {
    const message = rows[i].message;
    if (message.role !== 'assistant') continue;
    message.content = [...message.content, ...files];
    return;
  }
}
