import { expect, test } from 'bun:test';
import { badRequest, conflict, refusing } from './errors';

/**
 * The mapping every router states once. What matters is that it translates the
 * refusals it was given and nothing else: a fault that looks like a refusal
 * must not come back to the client as a polite 400.
 */

class Taken extends Error {}
class Malformed extends Error {}
class Bug extends Error {}

const attempt = refusing([Taken, conflict], [Malformed, badRequest]);

test('a listed refusal becomes its code, keeping its message', () => {
  expect(() =>
    attempt(() => {
      throw new Taken("'files' is already in use.");
    }),
  ).toThrow(expect.objectContaining({ code: 'CONFLICT', message: "'files' is already in use." }));

  expect(() =>
    attempt(() => {
      throw new Malformed('stdio needs a command.');
    }),
  ).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
});

test('order decides when one refusal extends another', () => {
  class Subtype extends Taken {}
  const narrowFirst = refusing([Subtype, badRequest], [Taken, conflict]);
  expect(() =>
    narrowFirst(() => {
      throw new Subtype('x');
    }),
  ).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
});

test('anything else travels untouched, because it is a fault and not a refusal', () => {
  const bug = new Bug('cannot read properties of undefined');
  expect(() =>
    attempt(() => {
      throw bug;
    }),
  ).toThrow(bug);
});

test('a call that does not throw is simply returned', () => {
  expect(attempt(() => ({ id: 'm1' }))).toEqual({ id: 'm1' });
});
