import type { Model } from '@earendil-works/pi-ai';

/**
 * Ark's two subscription plans: each one's endpoint, request format and catalog.
 *
 * Neither plan exposes a model listing and no public catalog covers them, so
 * this file is the catalog. Refresh it by hand from each plan's console page,
 * where a model's serving id is its display name lowercased.
 *
 * Limits start from pi's entry for the same model, or the vendor's own docs
 * where pi has none, and are then capped by what the plan accepts: Ark rejects
 * an output ask above its own ceiling, which can sit far below the vendor's.
 * The one marked ESTIMATE is undocumented and set low on purpose: a window too
 * small only folds early, while one too large is silently truncated.
 *
 * Membership, output caps and thinking support measured against the agent plan
 * on 2026-09-15; the coding plan follows its overview page.
 */

/** A plan is a subscription: per-token pricing would misreport every turn. */
const UNMETERED = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

type ArkModel = Model<'anthropic-messages'>;

type Spec = Pick<ArkModel, 'id' | 'name' | 'contextWindow' | 'maxTokens' | 'thinkingLevelMap'> & {
  vision: boolean;
};

/** Ark rejects a request that turns thinking off for these, so pi must never send one. */
const ALWAYS_THINKS: ArkModel['thinkingLevelMap'] = { off: null };

/** Served by both plans, in the console's own order. */
const SHARED: readonly Spec[] = [
  {
    id: 'doubao-seed-2.0-lite',
    name: 'Doubao Seed 2.0 lite',
    contextWindow: 262_144,
    maxTokens: 131_072,
    vision: true,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    contextWindow: 262_144,
    maxTokens: 32_768,
    thinkingLevelMap: ALWAYS_THINKS,
    vision: true,
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    vision: true,
  },
  {
    id: 'doubao-seed-evolving',
    name: 'Doubao Seed Evolving',
    contextWindow: 1_048_576,
    maxTokens: 262_144,
    vision: true,
  },
  { id: 'kimi-k3', name: 'Kimi K3', contextWindow: 1_048_576, maxTokens: 131_072, vision: true },
  // The coding plan documents a lower output cap than the agent plan serves.
  {
    id: 'doubao-seed-2.1-turbo',
    name: 'Doubao Seed 2.1 turbo',
    contextWindow: 262_144,
    maxTokens: 65_536,
    vision: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    vision: false,
  },
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    thinkingLevelMap: ALWAYS_THINKS,
    vision: false,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    vision: false,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    thinkingLevelMap: ALWAYS_THINKS,
    vision: true,
  },
];

/** Offered by the coding plan only. */
const CODING_ONLY: readonly Spec[] = [
  // ESTIMATE: routes across the whole pool, so it takes the smallest limits and
  // never turns thinking off.
  {
    id: 'auto',
    name: 'Auto',
    contextWindow: 262_144,
    maxTokens: 32_768,
    thinkingLevelMap: ALWAYS_THINKS,
    vision: false,
  },
];

/** Offered by the agent plan only. */
const AGENT_ONLY: readonly Spec[] = [
  {
    id: 'doubao-seed-2.0-mini',
    name: 'Doubao Seed 2.0 mini',
    contextWindow: 262_144,
    maxTokens: 131_072,
    vision: true,
  },
];

function toModels(specs: readonly Spec[], provider: string, baseUrl: string): ArkModel[] {
  return specs.map(({ vision, ...spec }) => ({
    ...spec,
    api: 'anthropic-messages',
    provider,
    baseUrl,
    reasoning: true,
    input: vision ? ['text', 'image'] : ['text'],
    cost: UNMETERED,
  }));
}

const AGENT_PLAN = {
  id: 'volcengine-agent',
  name: 'VolcEngine Ark - Agent Plan',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
} as const;

const CODING_PLAN = {
  id: 'volcengine-coding',
  name: 'VolcEngine Ark - Coding Plan',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
} as const;

export const volcengineAgentProviderConfig = {
  ...AGENT_PLAN,
  api: 'anthropic-messages',
  models: toModels([...SHARED, ...AGENT_ONLY], AGENT_PLAN.id, AGENT_PLAN.baseUrl),
} as const;

export const volcengineCodingProviderConfig = {
  ...CODING_PLAN,
  api: 'anthropic-messages',
  models: toModels([...CODING_ONLY, ...SHARED], CODING_PLAN.id, CODING_PLAN.baseUrl),
} as const;
