import type { Model } from '@earendil-works/pi-ai';

/**
 * Ark's two subscription plans, as engine catalog entries.
 *
 * The plans expose no listing API — `api/plan/v3/models` and `api/v1/models`
 * both 404 for a plan key, and the regular Ark endpoints reject one outright —
 * and no public dataset carries them: models.dev has no Ark provider at all.
 * So this file is the catalog, and it can only be refreshed by hand.
 *
 * To refresh: open the plan's console page, expand 可用模型, and lowercase each
 * display name — that is the serving id, dots included (Doubao-Seed-2.0-lite is
 * `doubao-seed-2.0-lite`). The console also answers `ListAgentPlanLatestModel`
 * with a version-pinned form (`doubao-seed-2-0-lite-260215`); both resolve, and
 * the bare alias is the one that survives a version bump.
 *
 * Windows are each model's own vendor figure rather than anything Ark states,
 * since Ark publishes none. Values marked ESTIMATE below have no vendor source
 * yet and are deliberately set low: folding early only costs a little context,
 * while a window that is too large is silently truncated rather than rejected.
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
  // ESTIMATE — a dispatch alias over the whole pool, so it is sized to the
  // smallest window in it rather than to whatever it happens to route to.
  { id: 'auto', name: 'Auto', contextWindow: 256_000, maxTokens: 131_072, vision: false },
  // ESTIMATE — same generation and version stamp as the mini below, which the
  // vendor documents at 256k.
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
  // ESTIMATE — newer than the 2.0 family and undocumented; held at the family's
  // window until the vendor states one.
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
  // ESTIMATE — too new for any catalog; the output cap is the vendor's own
  // sample call, the window is held low until they publish one.
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

/** The endpoint is passed in rather than repeated here: the manifest declares
 *  it once, and every model is stamped with the same one. */
export function arkAgentPlanModels(baseUrl: string): ArkModel[] {
  return toModels([...SHARED, ...AGENT_ONLY], 'volcengine-agent', baseUrl);
}

export function arkCodingPlanModels(baseUrl: string): ArkModel[] {
  return toModels(SHARED, 'volcengine-coding', baseUrl);
}
