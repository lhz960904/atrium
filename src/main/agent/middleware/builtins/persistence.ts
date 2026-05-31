import type { UIMessage } from 'ai';
import type { Db } from '../../../db';
import type { AgentMiddleware } from '../types';

export type PersistFn = (db: Db, threadId: string, message: UIMessage) => void;

/**
 * Persists the completed assistant message when the turn ends. The persister is
 * injected so the agent layer doesn't depend on the server layer (the assembly
 * site supplies the real persistMessage).
 */
export function persistenceMiddleware(persist: PersistFn): AgentMiddleware {
  return {
    name: 'persistence',
    afterRun(ctx, result) {
      persist(ctx.db, ctx.threadId, result.message);
    },
  };
}
