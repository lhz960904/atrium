import type { AtriumUIMessage } from '@shared/chat';
import type { RouterOutputs } from './trpc';

/** modelId → { maxContextTokens, pricing } from the models.info tRPC query. */
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

/** Distinct model ids that produced assistant turns in this thread. */
export function sessionModelIds(messages: AtriumUIMessage[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    const id = m.metadata?.modelId;
    if (id) ids.add(id);
  }
  return [...ids];
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
    const noCache = Math.max(0, inputTokens - cacheRead - cacheCreation);
    acc.inputTokens += inputTokens;
    acc.outputTokens += outputTokens;
    acc.cacheReadTokens += cacheRead;
    acc.cacheCreationTokens += cacheCreation;
    acc.totalTokens += md.totalTokens;
    const pricing = md.modelId ? info?.[md.modelId]?.pricing : undefined;
    if (pricing) {
      acc.inputCost += noCache * pricing.input;
      acc.outputCost += outputTokens * pricing.output;
      acc.cacheCost += cacheRead * pricing.cacheRead + cacheCreation * pricing.cacheCreation;
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
    if (md?.contextTokens == null || !md.modelId) continue;
    const max = info?.[md.modelId]?.maxContextTokens ?? 0;
    const pct = max > 0 ? Math.min(100, Math.round((md.contextTokens / max) * 100)) : 0;
    return { used: md.contextTokens, max, pct };
  }
  return null;
}

/** Compact USD: 4 decimals under $1 (sub-cent turns), 2 decimals above. */
export function formatUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
