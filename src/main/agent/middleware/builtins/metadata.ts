import type { AgentMiddleware } from '../types';

/**
 * Stamps per-message observability onto the UIMessage: createdAt at the start,
 * durationMs + totalTokens + contextTokens at the finish. Holds run state in
 * closure (one instance per run), so it must not be shared across runs.
 *
 * `totalTokens` is cumulative across steps (a cost figure). `contextTokens` is
 * the last step's input + output — the size of the prompt at turn end, which is
 * the accurate base for compaction's threshold check (cumulative usage would
 * overcount a multi-step tool loop several times over).
 */
export function metadataMiddleware(): AgentMiddleware {
  let startedAt = 0;
  let contextTokens: number | undefined;
  return {
    name: 'metadata',
    messageMetadata(part) {
      if (part.type === 'start') {
        startedAt = Date.now();
        return { createdAt: startedAt };
      }
      if (part.type === 'finish-step') {
        contextTokens = (part.usage.inputTokens ?? 0) + (part.usage.outputTokens ?? 0);
        return undefined;
      }
      if (part.type === 'finish') {
        return {
          durationMs: Date.now() - startedAt,
          totalTokens: part.totalUsage.totalTokens,
          contextTokens,
        };
      }
      return undefined;
    },
  };
}
