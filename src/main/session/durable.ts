/**
 * What the store will accept.
 *
 * Every append is checked against a strict notion of durable JSON: no
 * `undefined` anywhere, no class instances, no non-finite numbers. Our messages
 * routinely carry all three — a tool's `details` is whatever that tool returned,
 * an optional field left unset is `undefined` rather than absent — and one
 * rejected append fails the whole turn.
 *
 * Serializing and parsing back is exactly the normalization that check asks
 * for: absent keys really become absent, and anything that survived is by
 * definition what a later read would have produced anyway.
 */
export function durable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
