import { randomUUID } from 'node:crypto';
import type { ModelPricing } from '@main/agent/providers/models/types';
import { costUsd, type TokenCounts } from '../../shared/cost';
import type { Db } from '.';
import { usage } from './schema';

export type UsageKind = 'chat' | 'subagent' | 'title' | 'summary' | 'review';

/** Micro-USD (1e-6 dollar) cost of one call — integer for ledger storage. */
export function costMicros(t: TokenCounts, pricing: ModelPricing): number {
  return Math.round(costUsd(t, pricing) * 1_000_000);
}

export type RecordUsageInput = {
  threadId: string;
  messageId?: string;
  providerId: string;
  modelId: string;
  kind: UsageKind;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
};

/**
 * Append one LLM call to the usage ledger. Pricing is passed in (resolved by the
 * caller from the catalog) so this module stays free of the Electron-bound
 * catalog and is unit-testable. No-token calls are skipped.
 */
export function recordUsage(db: Db, input: RecordUsageInput, pricing: ModelPricing): void {
  const tokens: TokenCounts = {
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheCreationTokens: input.cacheCreationTokens ?? 0,
  };
  const totalTokens = input.totalTokens ?? tokens.inputTokens + tokens.outputTokens;
  if (totalTokens === 0) return;
  db.insert(usage)
    .values({
      id: randomUUID(),
      threadId: input.threadId,
      messageId: input.messageId ?? null,
      providerId: input.providerId,
      modelId: input.modelId,
      kind: input.kind,
      ...tokens,
      totalTokens,
      costUsdMicros: costMicros(tokens, pricing),
    })
    .run();
}
