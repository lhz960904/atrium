import type { Todo, TodoStatus } from '@shared/chat-types';
import type { ModelMessage, UIMessage } from 'ai';
import type { CompactionPreserver } from '../../compaction/preserver';

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

/** Latest settled todo_write plan in a UIMessage slice (cross-turn), or null. */
export function latestTodosUI(messages: UIMessage[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts ?? []) {
      // Static tool UI parts are typed `tool-<name>`; skip a still-streaming call.
      const p = part as { type?: string; state?: string; input?: unknown };
      if (p.type === 'tool-todo_write' && p.state !== 'input-streaming') {
        const todos = asTodos(p.input);
        if (todos) return todos;
      }
    }
  }
  return null;
}

/** Latest todo_write plan in a ModelMessage slice (within-turn), or null. */
export function latestTodosModel(messages: ModelMessage[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; toolName?: string; input?: unknown };
      if (p.type === 'tool-call' && p.toolName === 'todo_write') {
        const todos = asTodos(p.input);
        if (todos) return todos;
      }
    }
  }
  return null;
}

const PLAN_CARRY = 'Current plan (carry it forward — keep updating it with todo_write):';

function carry(inRecent: Todo[] | null, inFold: Todo[] | null): string | null {
  // Already in the kept window → the model still sees it; nothing to carry.
  if (inRecent || !inFold) return null;
  return `${PLAN_CARRY}\n${renderTodos(inFold)}`;
}

/** Carries the active plan across a compaction fold so the model keeps its exact list. */
export const todoPreserver: CompactionPreserver = {
  fromUI: (fold, recent) => carry(latestTodosUI(recent), latestTodosUI(fold)),
  fromModel: (fold, recent) => carry(latestTodosModel(recent), latestTodosModel(fold)),
};
