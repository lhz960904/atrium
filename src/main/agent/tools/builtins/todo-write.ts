import { defineTool, StringEnum, Type, textResult } from '../define';
import { renderTodos } from './todo';

/**
 * Plan tracking for multi-step work. The tool holds no state of its own — the
 * call's input *is* the plan, rendered by replaying the latest `todo_write`
 * from the message stream. execute just echoes a compact summary back to the
 * model so it sees its own list confirmed. The whole list is replaced each
 * call (no merge), matching Claude Code / DeerFlow.
 */
export const todoWriteTool = () =>
  defineTool({
    name: 'todo_write',
    label: 'Update plan',
    description: `Create and update a structured plan for the current task. The whole list is replaced on every call, so always send the full set of steps.

Use this for non-trivial work that takes 3+ distinct steps, when the user gives multiple tasks, or when a plan may shift as you learn more. Skip it for simple or conversational requests — just do those directly.

Keep it live: when you write the plan, mark the first step in_progress immediately; flip a step to completed the moment it's done (don't batch); keep exactly one step in_progress unless steps truly run in parallel. Only mark completed when fully done — if blocked, leave it in_progress and add a step describing what's needed.`,
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ description: 'Short, actionable description of the step.' }),
          status: StringEnum(['pending', 'in_progress', 'completed'], {
            description:
              'pending = not started, in_progress = working on it, completed = fully done.',
          }),
        }),
        { description: 'The full plan, in order. Replaces any previous plan.' },
      ),
    }),
    execute: async (_id, { todos }) => {
      const done = todos.filter((t) => t.status === 'completed').length;
      return textResult(`Plan updated · ${done}/${todos.length} done\n${renderTodos(todos)}`);
    },
  });
