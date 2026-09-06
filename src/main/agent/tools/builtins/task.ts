import type { RunContext } from '../../middleware/types';
import type { ModelPricing } from '../../models/types';
import { filterToolsForSubagent, resolveSubagentDef } from '../../subagent/defs';
import { runSubagent, type SubagentEngine } from '../../subagent/run';
import type { AtriumTool } from '../define';
import { defineTool, Type, textResult } from '../define';

const DEFAULT_SUBAGENT = 'general-purpose';

export type TaskToolDeps = {
  /** Pricing lookup, forwarded so the subagent records its own usage. */
  pricingOf?: (modelId: string) => ModelPricing;
  /** All delegatable subagents (built-in + custom), advertised in the description. */
  subagents: Array<{ name: string; description: string }>;
  /** The parent turn's context — the child reuses its sandbox / db / stream. */
  run: RunContext;
  /** How the parent reaches its provider; the child runs on the same handles. */
  engine?: SubagentEngine;
  /** The turn's whole tool set, read at call time — it includes this tool, so
   *  it cannot be handed over at construction. */
  siblings: () => AtriumTool[];
};

/**
 * Delegate a self-contained task to a subagent. The subagent runs in its own
 * isolated context and returns only a final result, so a big sweep of work
 * (a broad search, multi-source research) collapses to one short answer here
 * instead of flooding this conversation with intermediate detail.
 *
 * Deps are injected (the assembly site supplies them) rather than imported, so
 * this stays free of the Electron-bound catalog and unit-testable. The subagent
 * list is resolved per request, so freshly created ones show up.
 */
export const taskTool = (deps: TaskToolDeps) => {
  const list = deps.subagents.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return defineTool({
    name: 'task',
    label: 'Delegate task',
    description: `Delegate a self-contained task to a subagent that works in an isolated context and returns only its final result. Use this for work that takes many steps or would otherwise fill this conversation with intermediate detail (broad code searches, multi-source research). The subagent can't ask you questions, so give it everything it needs in the prompt.

Available subagents:
${list}`,
    parameters: Type.Object({
      description: Type.String({
        description:
          'A short 3-5 word label for the task, shown to the user (e.g. "research optical stocks").',
      }),
      prompt: Type.String({
        description:
          'The complete, self-contained task for the subagent to carry out autonomously, including any context it needs.',
      }),
      subagent: Type.Optional(
        Type.String({
          description: `Which subagent to delegate to, by name. Defaults to '${DEFAULT_SUBAGENT}'.`,
        }),
      ),
    }),
    execute: async (toolCallId, { prompt, subagent }, signal) => {
      const name = subagent ?? DEFAULT_SUBAGENT;
      const def = resolveSubagentDef(name, deps.run.db);
      if (!def) throw new Error(`unknown subagent '${name}'.`);

      if (!deps.engine) throw new Error('subagents are unavailable in this context.');

      const { text, usage } = await runSubagent({
        parent: deps.run,
        engine: deps.engine,
        tools: filterToolsForSubagent(deps.siblings(), def),
        agent: def,
        prompt,
        // Key the subagent's bubbled-up activity by the tool call id so the
        // frontend can correlate it with this task part's card.
        subagentId: toolCallId,
        pricingOf: deps.pricingOf,
        abortSignal: signal,
      });
      // The nested loop's own spend rides on the result, where the engine
      // accounts for tool-level usage.
      return { ...textResult(text), usage };
    },
  });
};
