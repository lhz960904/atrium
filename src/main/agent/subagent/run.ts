import type { AgentMessage as Message, StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, Model, TextContent, Usage } from '@earendil-works/pi-ai';
import { recordUsage } from '@main/db/usage';
import { createLogger } from '@main/utils/log';
import type { TokenRates } from '@shared/cost';
import type { ToolName } from '@shared/tools';
import { contextCompaction } from '../context/compaction';
import { createSummarizer } from '../context/summarize';
import { dateReminder } from '../context/system-reminder';
import { workspaceGuidance } from '../prompts';
import { resolvePiModel } from '../providers/models';
import { createAgentLoop } from '../runtime/agent-loop';
import { composeCapabilities } from '../runtime/capabilities';
import type { RunContext } from '../runtime/run-context';
import type { AtriumTool } from '../tools';
import { preserveTodos } from '../tools/builtins/todo';
import { loopDetection } from '../tools/loop-detection';
import type { SubagentDef } from './defs';

const log = createLogger('subagent');

/** What a nested loop needs to reach a provider — the parent's, by default. */
export type SubagentEngine = {
  model: Model<Api>;
  streamFn: StreamFn;
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
  pricingOf?: (providerId: string, modelId: string) => TokenRates;
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
  // parent's.
  let { model } = opts.engine;
  let providerId = parent.providerId;
  let modelId = parent.modelId;
  if (agent.providerId && agent.modelId) {
    try {
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
    parent.notice('subagent', { id: opts.subagentId, ...data });

  // A child explicitly opts into these capabilities; no implicit chat-policy bundle.
  const capabilities = [
    contextCompaction({
      summarize: createSummarizer(model),
      contextWindow: model.contextWindow,
      preservers: [preserveTodos],
    }),
    dateReminder(),
    loopDetection(),
  ];
  const child = createAgentLoop({
    systemPrompt,
    model,
    streamFn: opts.engine.streamFn,
    messages,
    tools: opts.tools,
    maxTurns: 100,
    ...composeCapabilities(capabilities),
  });

  const usage = zeroUsage();
  let lastText = '';
  child.subscribe((event) => {
    if (event.type === 'agent_end') {
      emit({ phase: 'done', status: 'done' });
      return;
    }
    if (event.type !== 'message_end') return;
    const message = event.message;
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

  emit({ phase: 'start' });
  try {
    await child.run(opts.abortSignal);
  } catch (err) {
    emit({ phase: 'done', status: 'failed' });
    throw err;
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
      opts.pricingOf(providerId, modelId),
    );
  }

  return { text: lastText || '(subagent finished without a text response)', usage };
}
