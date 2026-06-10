import { expect, test } from 'bun:test';
import type { PermissionOption } from '@agentclientprotocol/sdk';
import { AcpPermissionBroker, isAcpDecision } from './permission-broker';

const opt = (kind: PermissionOption['kind'], optionId: string): PermissionOption => ({
  kind,
  optionId,
  name: optionId,
});

const FULL: PermissionOption[] = [
  opt('allow_once', 'once'),
  opt('allow_always', 'always'),
  opt('reject_once', 'no'),
];

test('resolve settles the parked promise with the matching option', async () => {
  const broker = new AcpPermissionBroker();
  const { requestId, response } = broker.request('t1', FULL);
  expect(broker.resolve(requestId, 'allow_once')).toBe(true);
  expect(await response).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });
});

test('each decision maps to its option kind', async () => {
  const broker = new AcpPermissionBroker();
  const cases = [
    { decision: 'allow_always', expected: 'always' },
    { decision: 'reject_once', expected: 'no' },
  ] as const;
  for (const c of cases) {
    const { requestId, response } = broker.request('t1', FULL);
    broker.resolve(requestId, c.decision);
    expect(await response).toEqual({ outcome: { outcome: 'selected', optionId: c.expected } });
  }
});

test('allow_always falls back to allow_once but allow_once never escalates', async () => {
  const broker = new AcpPermissionBroker();
  const onceOnly = [opt('allow_once', 'once')];
  const a = broker.request('t1', onceOnly);
  broker.resolve(a.requestId, 'allow_always');
  expect(await a.response).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });

  const alwaysOnly = [opt('allow_always', 'always')];
  const b = broker.request('t1', alwaysOnly);
  broker.resolve(b.requestId, 'allow_once');
  expect(await b.response).toEqual({ outcome: { outcome: 'cancelled' } });
});

test('reject falls back to the persistent reject when once is not offered', async () => {
  const broker = new AcpPermissionBroker();
  const { requestId, response } = broker.request('t1', [
    opt('allow_once', 'once'),
    opt('reject_always', 'never'),
  ]);
  broker.resolve(requestId, 'reject_once');
  expect(await response).toEqual({ outcome: { outcome: 'selected', optionId: 'never' } });
});

test('unknown or already-settled request id is a no-op returning false', () => {
  const broker = new AcpPermissionBroker();
  const { requestId } = broker.request('t1', FULL);
  expect(broker.resolve('acp-perm-999', 'allow_once')).toBe(false);
  expect(broker.resolve(requestId, 'allow_once')).toBe(true);
  expect(broker.resolve(requestId, 'reject_once')).toBe(false);
});

test('cancelThread cancels every parked request of that thread only', async () => {
  const broker = new AcpPermissionBroker();
  const a = broker.request('t1', FULL);
  const b = broker.request('t1', FULL);
  const other = broker.request('t2', FULL);

  broker.cancelThread('t1');
  expect(await a.response).toEqual({ outcome: { outcome: 'cancelled' } });
  expect(await b.response).toEqual({ outcome: { outcome: 'cancelled' } });

  // t2 is untouched and still answerable.
  expect(broker.resolve(other.requestId, 'allow_once')).toBe(true);
  expect(await other.response).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });
});

test('isAcpDecision accepts only the button decisions', () => {
  expect(isAcpDecision('allow_once')).toBe(true);
  expect(isAcpDecision('allow_always')).toBe(true);
  expect(isAcpDecision('reject_once')).toBe(true);
  // Not a button: persistent deny, cancellation, junk, non-strings.
  expect(isAcpDecision('reject_always')).toBe(false);
  expect(isAcpDecision('cancelled')).toBe(false);
  expect(isAcpDecision('')).toBe(false);
  expect(isAcpDecision(undefined)).toBe(false);
});

test('request ids are unique across requests', () => {
  const broker = new AcpPermissionBroker();
  const a = broker.request('t1', FULL);
  const b = broker.request('t1', FULL);
  expect(a.requestId).not.toBe(b.requestId);
});
