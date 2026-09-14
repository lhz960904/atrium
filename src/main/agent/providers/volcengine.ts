import type { Model } from '@earendil-works/pi-ai';

/**
 * Ark's two subscription plans: each one's endpoint, request format and catalog.
 *
 * Neither plan exposes a model listing and no public catalog covers them, so
 * this file is the catalog. Refresh it by hand from each plan's console page,
 * where a model's serving id is its display name lowercased.
 *
 * Windows are each model's own vendor figure, since Ark publishes none. Those
 * marked ESTIMATE have no vendor source yet and are set low on purpose: a window
 * too small only folds early, while one too large is silently truncated.
 *
 * Checked against the console on 2026-09-13.
 */

/** A plan is a subscription: per-token pricing would misreport every turn. */
const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

type ArkModel = Model<'anthropic-messages'>;

type Spec = {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  vision: boolean;
};

/** Served by both plans, in the console's own order. */
const SHARED: readonly Spec[] = [
  // ESTIMATE: routes across the whole pool, so it is sized to the smallest window.
  { id: 'auto', name: 'Auto', contextWindow: 256_000, maxTokens: 131_072, vision: false },
  // ESTIMATE: sized like the agent plan's mini of the same generation.
  {
    id: 'doubao-seed-2.0-lite',
    name: 'Doubao Seed 2.0 lite',
    contextWindow: 256_000,
    maxTokens: 128_000,
    vision: true,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    contextWindow: 262_144,
    maxTokens: 262_144,
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
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    vision: true,
  },
  { id: 'kimi-k3', name: 'Kimi K3', contextWindow: 1_048_576, maxTokens: 131_072, vision: true },
  // ESTIMATE: undocumented, so it is held at the previous generation's window.
  {
    id: 'doubao-seed-2.1-turbo',
    name: 'Doubao Seed 2.1 turbo',
    contextWindow: 256_000,
    maxTokens: 131_072,
    vision: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    vision: false,
  },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, maxTokens: 131_072, vision: false },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    vision: false,
  },
  // ESTIMATE: no published window yet.
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    contextWindow: 200_000,
    maxTokens: 65_536,
    vision: true,
  },
];

/** Offered by the agent plan only. */
const AGENT_ONLY: readonly Spec[] = [
  {
    id: 'doubao-seed-2.0-mini',
    name: 'Doubao Seed 2.0 mini',
    contextWindow: 256_000,
    maxTokens: 128_000,
    vision: true,
  },
];

function toModels(specs: readonly Spec[], provider: string, baseUrl: string): ArkModel[] {
  return specs.map((s) => ({
    id: s.id,
    name: s.name,
    api: 'anthropic-messages',
    provider,
    baseUrl,
    reasoning: true,
    input: s.vision ? ['text', 'image'] : ['text'],
    cost: FREE,
    contextWindow: s.contextWindow,
    maxTokens: s.maxTokens,
  }));
}

const AGENT_PLAN = {
  id: 'volcengine-agent',
  name: 'Volcengine Agent Plan',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
} as const;

const CODING_PLAN = {
  id: 'volcengine-coding',
  name: 'Volcengine Coding Plan',
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
  models: toModels(SHARED, CODING_PLAN.id, CODING_PLAN.baseUrl),
} as const;
