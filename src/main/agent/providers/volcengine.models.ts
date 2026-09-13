import type { Model } from '@earendil-works/pi-ai';

/**
 * Ark's two subscription plans, as real engine catalog entries.
 *
 * The plan endpoints expose no `/models` listing, so this file is the catalog.
 * Without it an id falls through to the engine's generic default and a 256k
 * model gets folded at half its window.
 *
 * Every number here is copied in deliberately and dated, because nothing
 * upstream will correct it (checked 2026-09-13):
 *   - doubao-seed-2.0 family — 256k window, 128k output, multimodal, reasoning.
 *   - `ark-code-latest` — an auto-dispatch alias no catalog can know, sized to
 *     the smallest window in its dispatch pool.
 *   - `doubao-seed-code` — window per the vendor doc, output from its
 *     generation's family.
 *   - `deepseek-v4-*` — the one cross-vendor pair the plans serve at the same
 *     window as DeepSeek's own endpoint.
 *
 * The rest of what the plans serve for other vendors (minimax, glm, kimi) is
 * absent on purpose: a plan does not necessarily serve a model at its origin
 * window — Ark is known to cut some of them to a fraction — and guessing high
 * is the dangerous direction, since an over-large window is silently truncated
 * rather than rejected.
 *
 * Cost is zero throughout: a plan is a subscription, so per-token pricing
 * would misreport every turn.
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

function deepseekV4(id: string, provider: string, baseUrl: string, name: string): ArkModel {
  return {
    id,
    name,
    api: 'anthropic-messages',
    provider,
    baseUrl,
    reasoning: true,
    input: ['text'],
    cost: FREE,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
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
    deepseekV4('deepseek-v4-flash', p, b, 'DeepSeek V4 Flash'),
    deepseekV4('deepseek-v4-pro', p, b, 'DeepSeek V4 Pro'),
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
    deepseekV4('deepseek-v4-flash', p, b, 'DeepSeek V4 Flash'),
    deepseekV4('deepseek-v4-pro', p, b, 'DeepSeek V4 Pro'),
  ];
}
