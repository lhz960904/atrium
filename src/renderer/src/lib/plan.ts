import type { AtriumUIMessage } from '@shared/chat';
import type { Todo } from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import { getStaticToolName, isStaticToolUIPart } from 'ai';

/** The thread's active plan = the most recent settled `todo_write`, or null. */
export function getActivePlan(messages: AtriumUIMessage[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      // Skip a still-streaming call: its todos parse token by token, so the
      // count jitters until it settles. Keep the previous plan until then.
      if (
        isStaticToolUIPart(part) &&
        getStaticToolName<AtriumTools>(part) === 'todo_write' &&
        part.state !== 'input-streaming'
      ) {
        const todos = (part.input as { todos?: Todo[] } | undefined)?.todos;
        if (todos && todos.length > 0) {
          // An all-done plan has served its purpose — hide it.
          return todos.every((t) => t.status === 'completed') ? null : todos;
        }
      }
    }
  }
  return null;
}
