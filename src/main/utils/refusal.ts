/**
 * The domain will not do what was asked, and the message says why in words the
 * person who asked can act on: a name is taken, a config cannot be accepted, a
 * provisioned server is not theirs to edit.
 *
 * Anything else thrown is a fault — a bug, a failed write, a missing file — and
 * its message is written for us, not for them. The two are separate types
 * because that is the only distinction a caller can actually use; which status
 * code a refusal becomes is the business of whatever transport was reached
 * through, and a store never names one.
 */
export class Refusal extends Error {}

/** An error's own words, or the best available if it is not an Error at all. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
