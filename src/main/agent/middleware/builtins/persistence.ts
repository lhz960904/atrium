import { sealMessageToolCalls } from '@shared/seal-tool-calls';
import type { UIMessage } from 'ai';
import type { Db } from '../../../db';
import type { AgentMiddleware } from '../types';

export type PersistFn = (
  db: Db,
  threadId: string,
  message: UIMessage,
  opts?: { markRead?: boolean },
) => void;

/**
 * Persists the completed assistant message when the turn ends. The persister is
 * injected so the agent layer doesn't depend on the server layer (the assembly
 * site supplies the real persistMessage).
 *
 * A user-initiated stop is the viewer deciding the turn is done, so it counts as
 * read: persist the partial message as read, otherwise its updatedAt bump would
 * trip the sidebar's unread dot on the very thread the user is looking at (the
 * client's mark-read races this write and usually loses).
 */
export function persistenceMiddleware(persist: PersistFn): AgentMiddleware {
  return {
    name: 'persistence',
    afterRun(ctx, result) {
      // Seal any tool call that never returned before persisting: an aborted turn
      // leaves dangling tool_use parts that would break the thread's next request
      // (no-op when the turn finished cleanly).
      persist(ctx.db, ctx.threadId, sealMessageToolCalls(result.message), {
        markRead: result.aborted,
      });
    },
  };
}
