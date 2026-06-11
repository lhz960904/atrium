import { expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { reviewBoundaryCrossing } from './reviewer';

function verdictModel(
  reply: string | (() => Promise<never>),
  capture?: (o: LanguageModelV3CallOptions) => void,
): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async (opts) => {
      capture?.(opts);
      if (typeof reply !== 'string') return reply();
      return {
        content: [{ type: 'text', text: reply }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

const NET_RISK = 'reaches the network';

test('an explicit ALLOW auto-approves', async () => {
  const verdict = await reviewBoundaryCrossing({
    model: verdictModel('ALLOW'),
    subject: 'curl https://example.com',
    risk: NET_RISK,
  });
  expect(verdict).toBe('allow');
});

test('a DENY falls back to a prompt', async () => {
  expect(
    await reviewBoundaryCrossing({
      model: verdictModel('DENY'),
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
      await reviewBoundaryCrossing({ model: verdictModel(reply), subject: 'x', risk: NET_RISK }),
    ).toBe(expected);
  }
});

test('a model error resolves to deny, never a silent allow', async () => {
  const verdict = await reviewBoundaryCrossing({
    model: verdictModel(() => Promise.reject(new Error('model unreachable'))),
    subject: 'curl https://example.com',
    risk: NET_RISK,
  });
  expect(verdict).toBe('deny');
});

test('the crossing reason is fed to the model as a hint', async () => {
  let captured: LanguageModelV3CallOptions | undefined;
  await reviewBoundaryCrossing({
    model: verdictModel('ALLOW', (o) => {
      captured = o;
    }),
    subject: 'rm -rf node_modules',
    risk: 'is a potentially destructive command',
  });
  const prompt = JSON.stringify(captured?.prompt ?? '');
  expect(prompt).toContain('destructive');
  expect(prompt).toContain('rm -rf node_modules');
});
