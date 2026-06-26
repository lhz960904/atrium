import { randomUUID } from 'node:crypto';
import type { LanguageModelUsage } from 'ai';
import { costUsd, type TokenCounts } from '../../shared/cost';
import type { ModelPricing } from '../agent/models/types';
import type { Db } from '.';
import { usage } from './schema';

export type UsageKind = 'chat' | 'subagent' | 'title' | 'summary' | 'review';

/**
 * Token breakdown from an AI SDK usage object — the single place that maps
 * inputTokenDetails to our cache read/write fields, shared by the live metadata
 * stamp and the subagent's ledger write so the mapping is never duplicated.
 * Values pass through verbatim (undefined stays undefined, so metadata doesn't
 * fabricate zeros); the ledger defaults them to 0 in recordUsage.
 */
export function tokenCountsOf(u: LanguageModelUsage): Partial<TokenCounts> & {
  totalTokens: number | undefined;
} {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens,
    cacheCreationTokens: u.inputTokenDetails?.cacheWriteTokens,
    totalTokens: u.totalTokens,
  };
}

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
