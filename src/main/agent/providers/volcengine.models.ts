import type { Model } from '@earendil-works/pi-ai';

/**
 * Ark's two subscription plans, as real engine catalog entries.
 *
 * The plan endpoints expose no `/models` listing, so this file is the catalog:
 * without it every id falls through to the engine's 128k/8k/zero-cost default,
 * which folds a 256k model at half its window and prices its turns at nothing.
 *
 * Provenance, because these are hand-written and will go stale:
 *   - the doubao-seed-2.0 family is litellm's Ark-keyed data
 *     (`volcengine/doubao-seed-2-0-*-260215`): 256k window, 128k output,
 *     multimodal, tools, reasoning.
 *   - `ark-code-latest` is an auto-dispatch alias no catalog can know; the
 *     vendor doc's numbers, sized to the smallest window in its dispatch pool.
 *   - `doubao-seed-code` is retired from litellm; window from the vendor doc,
 *     output taken from its generation's family.
 * Models the plans serve on other vendors' behalf (deepseek, minimax, glm,
 * kimi) are deliberately absent: what Ark serves them with is not what their
 * own endpoints do, and guessing high is the dangerous direction — an
 * over-large window is silently truncated, not rejected.
 *
 * Cost is zero across the board: a plan is a subscription, so per-token
 * pricing would misreport every turn.
 */

// No `/v1`: the anthropic api appends `/v1/messages` itself, so a base
// carrying the segment would request it twice. Matches the manifest defaults,
// which is what a user without a configured override gets.
const AGENT_PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan';
const CODING_PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/coding';

const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

type ArkModel = Model<'anthropic-messages'>;

function doubaoSeed2(id: string, provider: string, baseUrl: string, name: string): ArkModel {
  return {
    id,
    name,
    api: 'anthropic-messages',
    provider,
    baseUrl,
    reasoning: true,
    input: ['text', 'image'],
    cost: FREE,
    contextWindow: 256_000,
    maxTokens: 128_000,
  };
}

function arkCodeLatest(provider: string, baseUrl: string): ArkModel {
  return {
    id: 'ark-code-latest',
    name: 'Ark Code (latest)',
    api: 'anthropic-messages',
    provider,
    baseUrl,
    reasoning: true,
    input: ['text'],
    cost: FREE,
    contextWindow: 200_000,
    maxTokens: 131_072,
  };
}

export function arkAgentPlanModels(): ArkModel[] {
  const p = 'volcengine-agent';
  const b = AGENT_PLAN_BASE;
  return [
    arkCodeLatest(p, b),
    doubaoSeed2('doubao-seed-2.0-mini', p, b, 'Doubao Seed 2.0 mini'),
    doubaoSeed2('doubao-seed-2.0-lite', p, b, 'Doubao Seed 2.0 lite'),
    doubaoSeed2('doubao-seed-2.0-code', p, b, 'Doubao Seed 2.0 code'),
    doubaoSeed2('doubao-seed-2.0-pro', p, b, 'Doubao Seed 2.0 pro'),
  ];
}

export function arkCodingPlanModels(): ArkModel[] {
  const p = 'volcengine-coding';
  const b = CODING_PLAN_BASE;
  return [
    arkCodeLatest(p, b),
    {
      id: 'doubao-seed-code',
      name: 'Doubao Seed Code',
      api: 'anthropic-messages',
      provider: p,
      baseUrl: b,
      reasoning: true,
      input: ['text', 'image'],
      cost: FREE,
      contextWindow: 262_144,
      maxTokens: 128_000,
    },
    doubaoSeed2('doubao-seed-2.0-code', p, b, 'Doubao Seed 2.0 code'),
    doubaoSeed2('doubao-seed-2.0-lite', p, b, 'Doubao Seed 2.0 lite'),
    doubaoSeed2('doubao-seed-2.0-pro', p, b, 'Doubao Seed 2.0 pro'),
  ];
}
