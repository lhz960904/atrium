/**
 * A refusal: the domain will not do what was asked, and the caller can act on
 * the answer rather than only report it.
 *
 * `kind` draws the one distinction a caller treats differently — the request
 * collided with what is already there, or it was not acceptable at all. What
 * each is called on the wire is the transport's business, so a store throws
 * these and never a status code.
 *
 * Anything not a Refusal is a fault: a bug, a failed write, a missing file. The
 * caller can only be told that something went wrong, which is why the two are
 * separate types rather than one with a flag.
 */
export type RefusalKind = 'collision' | 'unacceptable';

export class Refusal extends Error {
  constructor(
    readonly kind: RefusalKind,
    message: string,
  ) {
    super(message);
  }
}
