import type { AtriumMessageMetadata } from '../../../../shared/chat';
import { recordUsage } from '../../../db/usage';
import type { ModelPricing } from '../../models/types';
import type { AgentMiddleware } from '../types';

/**
 * Appends the finished turn to the usage ledger. Reads the token breakdown +
 * model off the message metadata the metadata middleware already stamped, and
 * prices it with the injected pricing lookup (kept out of this file so the
 * middleware barrel stays free of the Electron-bound catalog).
 */
export function usageMiddleware(pricingOf: (modelId: string) => ModelPricing): AgentMiddleware {
  return {
    name: 'usage',
    afterRun(ctx, result) {
      const md = result.message.metadata as AtriumMessageMetadata | undefined;
      if (!md?.providerId || !md.modelId) return;
      recordUsage(
        ctx.db,
        {
          threadId: ctx.threadId,
          messageId: result.message.id,
          providerId: md.providerId,
          modelId: md.modelId,
          kind: 'chat',
          inputTokens: md.inputTokens,
          outputTokens: md.outputTokens,
          cacheReadTokens: md.cacheReadTokens,
          cacheCreationTokens: md.cacheCreationTokens,
          totalTokens: md.totalTokens,
        },
        pricingOf(md.modelId),
      );
    },
  };
}
