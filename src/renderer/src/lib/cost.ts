import type { AtriumUIMessage } from '@shared/chat';
import { costBreakdownUsd } from '@shared/cost';
import type { RouterOutputs } from './trpc';

/** `providerId/modelId` → { maxContextTokens, pricing } from models.info. */
export type ModelInfoMap = RouterOutputs['models']['info'];

export type UsageAggregate = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  cacheCost: number;
  totalCost: number;
  /** True once every counted message's model pricing was available. */
  costComplete: boolean;
};

const ZERO: UsageAggregate = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
  inputCost: 0,
  outputCost: 0,
  cacheCost: 0,
  totalCost: 0,
  costComplete: true,
};

/** The key a models.info answer is stored under. A bare model id is ambiguous:
 *  two providers serving one id are two products with different windows. */
export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export type SessionModel = { providerId: string; modelId: string };

/** Distinct (provider, model) pairs that produced assistant turns here. */
export function sessionModels(messages: AtriumUIMessage[]): SessionModel[] {
  const seen = new Map<string, SessionModel>();
  for (const m of messages) {
    const { providerId, modelId } = m.metadata ?? {};
    if (providerId && modelId) seen.set(modelKey(providerId, modelId), { providerId, modelId });
  }
  return [...seen.values()];
}

/**
 * Sum tokens and cost across a thread's assistant turns. Each turn is priced
 * with its own model's rates (a thread may switch models). Cost follows the AI
 * SDK split: inputTokens is inclusive of cache, so the non-cached remainder is
 * billed at the input rate and the cache read/write tiers are billed separately.
 */
export function aggregateUsage(
  messages: AtriumUIMessage[],
  info: ModelInfoMap | undefined,
): UsageAggregate {
  const acc: UsageAggregate = { ...ZERO };
  for (const m of messages) {
    const md = m.metadata;
    if (!md || md.totalTokens == null) continue;
    const inputTokens = md.inputTokens ?? 0;
    const outputTokens = md.outputTokens ?? 0;
    const cacheRead = md.cacheReadTokens ?? 0;
    const cacheCreation = md.cacheCreationTokens ?? 0;
    acc.inputTokens += inputTokens;
    acc.outputTokens += outputTokens;
    acc.cacheReadTokens += cacheRead;
    acc.cacheCreationTokens += cacheCreation;
    acc.totalTokens += md.totalTokens;
    const pricing =
      md.providerId && md.modelId
        ? info?.[modelKey(md.providerId, md.modelId)]?.pricing
        : undefined;
    if (pricing) {
      const c = costBreakdownUsd(
        {
          inputTokens,
          outputTokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
        },
        pricing,
      );
      acc.inputCost += c.input;
      acc.outputCost += c.output;
      acc.cacheCost += c.cache;
    } else {
      acc.costComplete = false;
    }
  }
  acc.totalCost = acc.inputCost + acc.outputCost + acc.cacheCost;
  return acc;
}

export type ContextOccupancy = { used: number; max: number; pct: number };

/**
 * Context-window fill from the most recent turn that reported it: the last
 * step's prompt size over that model's window. Null until a turn has finished.
 */
export function contextOccupancy(
  messages: AtriumUIMessage[],
  info: ModelInfoMap | undefined,
): ContextOccupancy | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const md = messages[i].metadata;
    if (md?.contextTokens == null || !md.providerId || !md.modelId) continue;
    const max = info?.[modelKey(md.providerId, md.modelId)]?.maxContextTokens ?? 0;
    const pct = max > 0 ? Math.min(100, Math.round((md.contextTokens / max) * 100)) : 0;
    return { used: md.contextTokens, max, pct };
  }
  return null;
}

/** Compact USD: 4 decimals under $1 (sub-cent turns), 2 decimals above. */
export function formatUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
