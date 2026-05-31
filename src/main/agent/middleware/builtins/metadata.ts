import type { AgentMiddleware } from '../types';

/**
 * Stamps per-message observability onto the UIMessage: createdAt at the start,
 * durationMs + totalTokens at the finish. Holds the start time in closure (one
 * instance per run), so it must not be shared across runs.
 */
export function metadataMiddleware(): AgentMiddleware {
  let startedAt = 0;
  return {
    name: 'metadata',
    messageMetadata(part) {
      if (part.type === 'start') {
        startedAt = Date.now();
        return { createdAt: startedAt };
      }
      if (part.type === 'finish') {
        return { durationMs: Date.now() - startedAt, totalTokens: part.totalUsage?.totalTokens };
      }
      return undefined;
    },
  };
}
