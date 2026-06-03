import { generateId, tool } from 'ai';
import { z } from 'zod';
import type { Logger } from '../../../log';
import type { RunContext } from '../../middleware';
import { resolveSubagentDef } from '../../subagent/defs';
import { runSubagent } from '../../subagent/run';

const DEFAULT_SUBAGENT = 'general-purpose';

export type TaskToolDeps = {
  maxContextTokens: (modelId: string) => number;
  log: Logger;
  /** All delegatable subagents (built-in + custom), advertised in the description. */
  subagents: Array<{ name: string; description: string }>;
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
  return tool({
    description: `Delegate a self-contained task to a subagent that works in an isolated context and returns only its final result. Use this for work that takes many steps or would otherwise fill this conversation with intermediate detail (broad code searches, multi-source research). The subagent can't ask you questions, so give it everything it needs in the prompt.

Available subagents:
${list}`,
    inputSchema: z.object({
      description: z
        .string()
        .describe(
          'A short 3-5 word label for the task, shown to the user (e.g. "research optical stocks").',
        ),
      prompt: z
        .string()
        .describe(
          'The complete, self-contained task for the subagent to carry out autonomously, including any context it needs.',
        ),
      subagent: z
        .string()
        .optional()
        .describe(`Which subagent to delegate to, by name. Defaults to '${DEFAULT_SUBAGENT}'.`),
    }),
    execute: async ({ prompt, subagent }, { experimental_context, abortSignal }) => {
      const ctx = experimental_context as RunContext;
      const name = subagent ?? DEFAULT_SUBAGENT;
      const def = resolveSubagentDef(name, ctx.db);
      if (!def) return `Error: unknown subagent '${name}'.`;

      const { text } = await runSubagent({
        parent: ctx,
        agent: def,
        prompt,
        subagentId: generateId(),
        maxContextTokens: deps.maxContextTokens,
        log: deps.log,
        abortSignal,
      });
      return text;
    },
  });
};
