import type { Todo, TodoStatus } from '@shared/chat-types';
import type { AssistantMessage, Message } from '@shared/protocol';
import type { ContextPreserver } from '../../runtime/compaction';

/**
 * The todo domain: how a plan renders as text, how to find the active plan in a
 * message stream, and how to carry it across a compaction fold. Owned here (with
 * the todo_write tool) and consumed by the tool's echo + compaction's preserver
 * — compaction stays ignorant of what a plan is.
 */

const STATUS_MARKER: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[>]',
  completed: '[x]',
};

export function renderTodos(todos: Todo[]): string {
  return todos.map((t) => `${STATUS_MARKER[t.status]} ${t.content}`).join('\n');
}

function asTodos(input: unknown): Todo[] | null {
  const todos = (input as { todos?: Todo[] } | undefined)?.todos;
  return todos && todos.length > 0 ? todos : null;
}

const PLAN_CARRY = 'Current plan (carry it forward — keep updating it with todo_write):';

function carry(inRecent: Todo[] | null, inFold: Todo[] | null): string | null {
  // Already in the kept window → the model still sees it; nothing to carry.
  if (inRecent || !inFold) return null;
  return `${PLAN_CARRY}\n${renderTodos(inFold)}`;
}

/** Latest todo_write plan in a slice of the engine's transcript, or null. */
export function latestTodos(messages: Message[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    for (const content of (message as AssistantMessage).content) {
      const part = content as { type?: string; name?: string; arguments?: unknown };
      if (part.type === 'toolCall' && part.name === 'todo_write') {
        const todos = asTodos(part.arguments);
        if (todos) return todos;
      }
    }
  }
  return null;
}

/** Carries the active plan across a compaction fold so the model keeps its exact list. */
export const preserveTodos: ContextPreserver = (fold, recent) =>
  carry(latestTodos(recent), latestTodos(fold));
