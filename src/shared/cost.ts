/**
 * The single source of truth for token cost math, shared by the renderer's live
 * readout and the main-process usage ledger so they can never drift. The ledger
 * scales the result to micro-USD for integer storage; the renderer uses the
 * float directly.
 */

/** Token counts for one call; inputTokens is inclusive of cache (AI SDK semantics). */
export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/** Per-token USD rates (matches ModelPricing / models.info pricing). */
export type TokenRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

/**
 * Per-category USD cost of one call. inputTokens is inclusive of cache, so the
 * non-cached remainder bills at the input rate and the cache read/write tiers
 * bill at their own rates.
 */
export function costBreakdownUsd(
  t: TokenCounts,
  r: TokenRates,
): { input: number; output: number; cache: number } {
  const noCache = Math.max(0, t.inputTokens - t.cacheReadTokens - t.cacheCreationTokens);
  return {
    input: noCache * r.input,
    output: t.outputTokens * r.output,
    cache: t.cacheReadTokens * r.cacheRead + t.cacheCreationTokens * r.cacheCreation,
  };
}

/** Total USD cost of one call. */
export function costUsd(t: TokenCounts, r: TokenRates): number {
  const b = costBreakdownUsd(t, r);
  return b.input + b.output + b.cache;
}
