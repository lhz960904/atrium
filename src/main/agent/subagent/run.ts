import { Agent, type StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model, Message as PiMessage } from '@earendil-works/pi-ai';
import type { AssistantMessage, Message, TextContent, Usage } from '@shared/protocol';
import type { ToolName } from '@shared/tools';
import { recordUsage } from '../../db/usage';
import { createLogger } from '../../log';
import type { RunContext } from '../middleware';
import type { ModelPricing } from '../models/types';
import { withinTurnFold } from '../pi/compaction';
import { composeContext } from '../pi/context';
import { injectSystemReminder } from '../pi/history';
import { createLoopDetector } from '../pi/loop-detection';
import { createSummarizer } from '../pi/summarize';
import { asPi, storedMessage } from '../pi/vocabulary';
import { currentDateNote, workspaceGuidance } from '../prompts';
import type { AtriumTool } from '../tools';
import { preserveTodos } from '../tools/builtins/todo';
import type { SubagentDef } from './defs';

const log = createLogger('subagent');

const SUBAGENT_MAX_TURNS = 100;

/** What a nested loop needs to reach a provider — the parent's, by default. */
export type SubagentEngine = {
  model: Model<Api>;
  streamFn: StreamFn;
  getApiKey: (provider: string) => string | undefined;
};

export type SubagentResult = { text: string; usage: Usage };

export type RunSubagentOptions = {
  /** Carries the run's sandbox / workspace / db / stream that the child reuses. */
  parent: RunContext;
  engine: SubagentEngine;
  /** The child's tools, already filtered to what its definition allows. */
  tools: AtriumTool[];
  agent: SubagentDef;
  /** The task handed to the subagent — its sole initial user message. */
  prompt: string;
  /** Correlates the child's bubbled-up activity with its UI block. */
  subagentId: string;
  /** Pricing lookup for the usage ledger; omitted in tests (skips recording). */
  pricingOf?: (modelId: string) => ModelPricing;
  abortSignal?: AbortSignal;
};

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function addUsage(total: Usage, next: Usage): void {
  total.input += next.input;
  total.output += next.output;
  total.cacheRead += next.cacheRead;
  total.cacheWrite += next.cacheWrite;
  total.totalTokens += next.totalTokens;
  total.cost.input += next.cost.input;
  total.cost.output += next.cost.output;
  total.cost.cacheRead += next.cost.cacheRead;
  total.cost.cacheWrite += next.cost.cacheWrite;
  total.cost.total += next.cost.total;
}

const textOf = (message: AssistantMessage): string =>
  message.content
    .flatMap((c) => (c.type === 'text' ? [(c as TextContent).text] : []))
    .join('')
    .trim();

/**
 * Run a subagent: a nested agent loop with its own system prompt, a filtered
 * slice of the parent's tools, and a fresh ephemeral context (only the task
 * prompt — none of the parent's history). It runs the full loop and returns
 * ONLY the final assistant text; every intermediate tool call and result stays
 * inside the child and never reaches the parent's context. That isolation is
 * the point — a big sweep of work collapses to one short answer here.
 *
 * The child reuses within-turn compaction (it can run many turns and overflow
 * its own window) but never the cross-turn path — it has no persisted history
 * to check point against.
 */
export async function runSubagent(opts: RunSubagentOptions): Promise<SubagentResult> {
  const { parent, agent } = opts;

  // Pin the subagent to its own model if it has a valid one, else inherit the
  // parent's. resolvePiModel is imported lazily — it pulls in the Electron-bound
  // credential store, which we don't want loaded when there's nothing to resolve
  // (and which would break non-Electron unit tests on import).
  let { model } = opts.engine;
  let providerId = parent.providerId;
  let modelId = parent.modelId;
  if (agent.providerId && agent.modelId) {
    try {
      const { resolvePiModel } = await import('../../providers/pi-model');
      model = resolvePiModel(parent.db, agent.providerId, agent.modelId);
      providerId = agent.providerId;
      modelId = agent.modelId;
    } catch (err) {
      log.warn(
        `subagent '${agent.name}' pinned model ${agent.providerId}/${agent.modelId} is unavailable, inheriting the parent's model: ${(err as Error).message}`,
      );
    }
  }

  const systemPrompt = `${agent.systemPrompt}\n\n${workspaceGuidance(parent.workspaceRoot)}`;
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: opts.prompt }], timestamp: Date.now() },
  ];

  const emit = (data: Record<string, unknown>): void =>
    parent.emit({ type: 'data-subagent', data: { id: opts.subagentId, ...data }, transient: true });

  const loop = createLoopDetector();
  let turns = 0;

  const child = new Agent({
    initialState: { systemPrompt, model, tools: opts.tools, messages: asPi(messages) },
    streamFn: opts.engine.streamFn,
    getApiKey: opts.engine.getApiKey,
    convertToLlm: (m) => m as PiMessage[],
    transformContext: composeContext([
      withinTurnFold({
        summarize: createSummarizer({ ...opts.engine, model }),
        contextWindow: model.contextWindow,
        preservers: [preserveTodos],
      }),
      (m) => injectSystemReminder(m, currentDateNote(new Date()), { anchor: 'last' }),
      loop.transform,
    ]),
    prepareNextTurnWithContext: async ({ message, context }) => {
      loop.observe(message);
      return { context: { ...context, tools: loop.stopped ? [] : opts.tools } };
    },
    shouldStopAfterTurn: () => ++turns >= SUBAGENT_MAX_TURNS,
  });

  const usage = zeroUsage();
  let lastText = '';
  child.subscribe((event) => {
    if (event.type === 'agent_end') {
      emit({ phase: 'done', status: 'done' });
      return;
    }
    if (event.type !== 'message_end') return;
    const message = storedMessage(event.message);
    if (message.role !== 'assistant') return;
    addUsage(usage, message.usage);
    const text = textOf(message);
    if (text) lastText = text;
    // Bubble the turn's calls up so the parent's task card shows a live activity
    // list. Only name + input go up — the card shows a static line, no output —
    // and todo_write is a plan-panel concern, not trace.
    const tools = message.content
      .flatMap((c) =>
        c.type === 'toolCall'
          ? [c as unknown as { id: string; name: string; arguments: unknown }]
          : [],
      )
      .filter((c) => c.name !== 'todo_write')
      .map((c) => ({ id: c.id, name: c.name as ToolName, input: c.arguments }));
    if (tools.length > 0) emit({ phase: 'step', tools });
  });

  const stop = () => child.abort();
  opts.abortSignal?.addEventListener('abort', stop, { once: true });

  emit({ phase: 'start' });
  try {
    await child.continue();
  } catch (err) {
    emit({ phase: 'done', status: 'failed' });
    throw err;
  } finally {
    opts.abortSignal?.removeEventListener('abort', stop);
  }

  // Subagent calls are separate model calls, invisible to the parent turn's
  // usage — record them on their own so the ledger isn't an undercount.
  if (opts.pricingOf && providerId && modelId) {
    recordUsage(
      parent.db,
      {
        threadId: parent.threadId,
        kind: 'subagent',
        providerId,
        modelId,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheCreationTokens: usage.cacheWrite,
        totalTokens: usage.totalTokens,
      },
      opts.pricingOf(modelId),
    );
  }

  return { text: lastText || '(subagent finished without a text response)', usage };
}
