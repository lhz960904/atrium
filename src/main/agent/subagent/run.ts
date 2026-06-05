import type { ToolName } from '@shared/tools';
import { convertToModelMessages, generateId, stepCountIs, streamText, type UIMessage } from 'ai';
import { createLogger } from '../../log';
import { compactionMiddleware, composeBeforeStep, type RunContext } from '../middleware';
import { workspaceGuidance } from '../prompts';
import { todoPreserver } from '../tools/builtins/todo';
import { filterToolsForSubagent, type SubagentDef } from './defs';

const log = createLogger('subagent');

const SUBAGENT_MAX_STEPS = 100;

export type SubagentResult = { text: string; usage?: { totalTokens?: number } };

export type RunSubagentOptions = {
  /** Carries the run's model / sandbox / workspace / db that the child reuses. */
  parent: RunContext;
  agent: SubagentDef;
  /** The task handed to the subagent — its sole initial user message. */
  prompt: string;
  /** Correlates the child's bubbled-up activity with its UI block (used later). */
  subagentId: string;
  /** Context window per model id (injected, like compaction — avoids importing
   *  the Electron-bound catalog here so this stays unit-testable). */
  maxContextTokens: (modelId: string) => number;
  abortSignal?: AbortSignal;
};

/**
 * Run a subagent: a nested agent loop with its own system prompt, a filtered
 * slice of the parent's tools, and a fresh ephemeral context (only the task
 * prompt — none of the parent's history). It runs the full ReAct loop and
 * returns ONLY the final assistant text; every intermediate tool call/result
 * stays inside the child and never reaches the parent's context. That isolation
 * is the point — a big sweep of work collapses to one short result.
 *
 * The child reuses within-turn compaction (it can run many steps and overflow
 * its own window) but never the cross-turn path — it has no persisted history.
 */
export async function runSubagent(opts: RunSubagentOptions): Promise<SubagentResult> {
  const { parent, agent, prompt } = opts;

  // Pin the subagent to its own model if it has a valid one, else inherit the
  // parent's. resolveModel is imported lazily — it pulls in the Electron-bound
  // credential store, which we don't want loaded when there's nothing to resolve
  // (and which would break non-Electron unit tests on import).
  let model = parent.model;
  if (agent.providerId && agent.modelId) {
    try {
      const { resolveModel } = await import('../../providers/resolve');
      model = resolveModel(parent.db, agent.providerId, agent.modelId);
    } catch (err) {
      log.warn(
        `subagent '${agent.name}' pinned model ${agent.providerId}/${agent.modelId} is unavailable, inheriting the parent's model: ${(err as Error).message}`,
      );
    }
  }

  const tools = filterToolsForSubagent(parent.request.tools, agent);
  const system = `${agent.systemPrompt}\n\n${workspaceGuidance(parent.workspaceRoot)}`;
  const messages: UIMessage[] = [
    { id: generateId(), role: 'user', parts: [{ type: 'text', text: prompt }] },
  ];

  const subCtx: RunContext = {
    threadId: parent.threadId,
    db: parent.db,
    sandbox: parent.sandbox,
    workspaceRoot: parent.workspaceRoot,
    request: { system, messages, tools },
    model,
    // The child's own middleware (within-turn compaction) doesn't emit; its
    // activity is bubbled to the parent's stream below via parent.emit instead.
    emit: () => {},
    scratch: new Map(),
  };

  const middlewares = [
    compactionMiddleware({
      maxContextTokens: opts.maxContextTokens,
      // Never actually invoked: the child opens with only its task prompt, so
      // the cross-turn pass can't fold a single message and persists nothing.
      // Only within-turn folding (as the loop grows) ever fires.
      persist: () => {},
      preservers: [todoPreserver],
    }),
  ];
  const beforeStep = composeBeforeStep(subCtx, middlewares);

  const emit = (data: Record<string, unknown>): void =>
    parent.emit({ type: 'data-subagent', data: { id: opts.subagentId, ...data }, transient: true });

  emit({ phase: 'start' });
  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    prepareStep: ({ stepNumber, messages }) => beforeStep({ stepNumber, messages }),
    abortSignal: opts.abortSignal,
    // Bubble each step's completed tool calls up to the parent so its task card
    // shows a live activity list. todo_write is a plan-panel concern, not trace.
    // Only name + input go up — the card shows a static line, no output.
    onStepFinish: ({ toolCalls }) => {
      const tools = toolCalls
        .filter((tc) => tc.toolName !== 'todo_write')
        .map((tc) => ({ id: tc.toolCallId, name: tc.toolName as ToolName, input: tc.input }));
      if (tools.length > 0) emit({ phase: 'step', tools });
    },
  });

  try {
    // Drive the loop to completion, then take the final assistant text.
    const text = (await result.text).trim();
    const usage = { totalTokens: (await result.totalUsage).totalTokens };
    emit({ phase: 'done', status: 'done' });
    if (text) return { text, usage };

    // The loop ended on a tool step with no closing text (e.g. it hit the step
    // cap) — fall back to the most recent step that did produce text.
    const steps = await result.steps;
    for (let i = steps.length - 1; i >= 0; i--) {
      const t = steps[i].text?.trim();
      if (t) return { text: t, usage };
    }
    return { text: '(subagent finished without a text response)', usage };
  } catch (err) {
    emit({ phase: 'done', status: 'failed' });
    throw err;
  }
}
