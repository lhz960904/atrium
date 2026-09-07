import { expect, test } from 'bun:test';
import type { Complete } from '../pi/complete';
import { reviewBoundaryCrossing } from './reviewer';

function verdictModel(
  reply: string | (() => Promise<never>),
  capture?: (input: { system: string; prompt: string }) => void,
): Complete {
  return async (input) => {
    capture?.(input);
    if (typeof reply !== 'string') return reply();
    return reply;
  };
}

const NET_RISK = 'reaches the network';

test('an explicit ALLOW auto-approves', async () => {
  const verdict = await reviewBoundaryCrossing({
    complete: verdictModel('ALLOW'),
    subject: 'curl https://example.com',
    risk: NET_RISK,
  });
  expect(verdict).toBe('allow');
});

test('a DENY falls back to a prompt', async () => {
  expect(
    await reviewBoundaryCrossing({
      complete: verdictModel('DENY'),
      subject: 'rm -rf /',
      risk: 'is a potentially destructive command',
    }),
  ).toBe('deny');
});

test('verdict parsing is forgiving but safe: extra prose, casing, and DENY-wins', async () => {
  const cases: Array<[string, 'allow' | 'deny']> = [
    ['allow', 'allow'],
    ['  ALLOW\n', 'allow'],
    ['I think this is fine, ALLOW', 'allow'],
    ['Deny', 'deny'],
    ['ALLOW or DENY? DENY', 'deny'], // names both → deny wins
    ['maybe', 'deny'], // no explicit verdict → deny
    ['', 'deny'],
  ];
  for (const [reply, expected] of cases) {
    expect(
      await reviewBoundaryCrossing({ complete: verdictModel(reply), subject: 'x', risk: NET_RISK }),
    ).toBe(expected);
  }
});

test('a model error resolves to deny, never a silent allow', async () => {
  const verdict = await reviewBoundaryCrossing({
    complete: verdictModel(() => Promise.reject(new Error('model unreachable'))),
    subject: 'curl https://example.com',
    risk: NET_RISK,
  });
  expect(verdict).toBe('deny');
});

test('the crossing reason is fed to the model as a hint', async () => {
  let captured: { prompt: string } | undefined;
  await reviewBoundaryCrossing({
    complete: verdictModel('ALLOW', (input) => {
      captured = input;
    }),
    subject: 'rm -rf node_modules',
    risk: 'is a potentially destructive command',
  });
  expect(captured?.prompt).toContain('destructive');
  expect(captured?.prompt).toContain('rm -rf node_modules');
});
