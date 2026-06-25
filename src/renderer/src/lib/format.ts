/** Compact token count: <10k grouped (1,234), <1M as 12.3k, ≥1M as 1.2M. */
export function formatTokens(n: number): string {
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
