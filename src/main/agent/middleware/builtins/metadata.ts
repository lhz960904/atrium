import type { AgentMiddleware } from '../types';

/**
 * Stamps per-message observability onto the UIMessage: createdAt at the start,
 * durationMs + token breakdown + contextTokens at the finish. Holds run state in
 * closure (one instance per run), so it must not be shared across runs.
 *
 * `totalTokens` is cumulative across steps (a cost figure). `inputTokens` is
 * inclusive of cache read + write (AI SDK semantics); the cache split is carried
 * separately so the UI can show cost and cache-hit ratio. `contextTokens` is the
 * last step's input + output — the size of the prompt at turn end, the accurate
 * base for compaction's threshold check (cumulative usage would overcount a
 * multi-step tool loop several times over).
 */
export function metadataMiddleware(model?: {
  providerId: string;
  modelId: string;
}): AgentMiddleware {
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
        const u = part.totalUsage;
        return {
          durationMs: Date.now() - startedAt,
          providerId: model?.providerId,
          modelId: model?.modelId,
          totalTokens: u.totalTokens,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cacheReadTokens: u.inputTokenDetails?.cacheReadTokens,
          cacheCreationTokens: u.inputTokenDetails?.cacheWriteTokens,
          contextTokens,
        };
      }
      return undefined;
    },
  };
}
