/**
 * Per-token USD rates for one model, as `models.info` reports them.
 *
 * Nothing here prices a call. The provider returns what each call cost and pi
 * carries it on the message, tiered pricing and Anthropic's dearer 1h cache
 * writes included; recomputing that from rates is how the two drift apart.
 * Rates survive only for the questions a bill cannot answer — chiefly what the
 * cached tokens *would* have cost at the full input rate.
 */
export type TokenRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};
