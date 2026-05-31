import type { AtriumUIMessage } from '@shared/chat';
import type { Todo } from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import { getStaticToolName, isStaticToolUIPart } from 'ai';

/**
 * The thread's active plan = the most recent `todo_write` call across all
 * messages. Each call replaces the whole list, so the latest one is the
 * current plan; reconstructing it from the message parts means it survives
 * reloads and stream resumption with no separate state channel. Returns null
 * when no plan has been written (the panel then renders nothing).
 */
export function getActivePlan(messages: AtriumUIMessage[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (isStaticToolUIPart(part) && getStaticToolName<AtriumTools>(part) === 'todo_write') {
        const todos = (part.input as { todos?: Todo[] } | undefined)?.todos;
        if (todos && todos.length > 0) return todos;
      }
    }
  }
  return null;
}
