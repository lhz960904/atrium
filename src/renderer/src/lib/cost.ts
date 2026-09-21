import type { AtriumUIMessage } from '@shared/chat';
import type { RouterOutputs } from './trpc';

/** `providerId/modelId` → { maxContextTokens } from models.info. */
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
 * Sum tokens and cost across a thread's assistant turns.
 *
 * Every figure here was reported by the provider and carried down on the turn;
 * nothing is repriced from rates. A turn whose model had no pricing reports a
 * zero cost, and `costComplete` goes false so the readout stays silent rather
 * than claiming the thread was free.
 */
export function aggregateUsage(messages: AtriumUIMessage[]): UsageAggregate {
  const acc: UsageAggregate = { ...ZERO };
  for (const m of messages) {
    const md = m.metadata;
    if (!md || md.totalTokens == null) continue;
    acc.inputTokens += md.inputTokens ?? 0;
    acc.outputTokens += md.outputTokens ?? 0;
    acc.cacheReadTokens += md.cacheReadTokens ?? 0;
    acc.cacheCreationTokens += md.cacheCreationTokens ?? 0;
    acc.totalTokens += md.totalTokens;
    if (!md.cost) {
      acc.costComplete = false;
      continue;
    }
    acc.inputCost += md.cost.input;
    acc.outputCost += md.cost.output;
    acc.cacheCost += md.cost.cache;
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
