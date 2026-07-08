import { sealDanglingToolCalls } from '@shared/seal-tool-calls';
import type { AgentMiddleware, RunContext } from '../types';

/**
 * Backstop: before the model call, seal any dangling tool call left in the
 * history by an interrupted earlier turn (a user stop, a crash, a killed
 * scheduled run). A tool_use with no tool_result makes the provider reject the
 * whole request, so this keeps one corrupted message from wedging every future
 * turn on the thread. Request-only — it sanitizes what the model sees and does
 * not rewrite the stored message; the persistence path seals that at write time.
 */
export function toolCallSealerMiddleware(): AgentMiddleware {
  return {
    name: 'tool-call-sealer',
    beforeRun(ctx: RunContext): void {
      ctx.request.messages = sealDanglingToolCalls(ctx.request.messages);
    },
  };
}
