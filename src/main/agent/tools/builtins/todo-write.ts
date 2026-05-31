import type { Todo } from '@shared/chat-types';
import { tool } from 'ai';
import { z } from 'zod';

const STATUS_MARKER: Record<Todo['status'], string> = {
  pending: '[ ]',
  in_progress: '[>]',
  completed: '[x]',
};

/**
 * Plan tracking for multi-step work. The tool holds no state of its own — the
 * call's input *is* the plan, rendered by replaying the latest `todo_write`
 * from the message stream. execute just echoes a compact summary back to the
 * model so it sees its own list confirmed. The whole list is replaced each
 * call (no merge), matching Claude Code / DeerFlow.
 */
export const todoWriteTool = () =>
  tool({
    description: `Create and update a structured plan for the current task. The whole list is replaced on every call, so always send the full set of steps.

Use this for non-trivial work that takes 3+ distinct steps, when the user gives multiple tasks, or when a plan may shift as you learn more. Skip it for simple or conversational requests — just do those directly.

Keep it live: when you write the plan, mark the first step in_progress immediately; flip a step to completed the moment it's done (don't batch); keep exactly one step in_progress unless steps truly run in parallel. Only mark completed when fully done — if blocked, leave it in_progress and add a step describing what's needed.`,
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            content: z.string().describe('Short, actionable description of the step.'),
            status: z
              .enum(['pending', 'in_progress', 'completed'])
              .describe('pending = not started, in_progress = working on it, completed = fully done.'),
          }),
        )
        .describe('The full plan, in order. Replaces any previous plan.'),
    }),
    execute: async ({ todos }) => {
      const done = todos.filter((t) => t.status === 'completed').length;
      const lines = todos.map((t) => `${STATUS_MARKER[t.status]} ${t.content}`).join('\n');
      return `Plan updated · ${done}/${todos.length} done\n${lines}`;
    },
  });
