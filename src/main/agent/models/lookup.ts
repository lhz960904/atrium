import type { ModelCapabilities, ModelInfo, ModelsCatalog } from './types';

/** Conservative window for ids the dataset doesn't know — compact early, never overflow. */
export const FALLBACK_CONTEXT_TOKENS = 128_000;

/** Atrium provider ids (see providers/manifest.ts) → models.dev provider keys. */
const PROVIDER_ALIASES: Record<string, string> = {
  moonshot: 'moonshotai',
  'kimi-coding': 'kimi-for-coding',
  'zai-coding': 'zai',
};

/**
 * Resolve a (providerId, modelId) to its dataset entry. Tries the aliased
 * provider first, then the raw providerId, then a cross-provider search by
 * exact model id — the last covers aggregators (OpenRouter, AiHubMix) and
 * local-CLI wrappers whose provider id isn't a models.dev key but whose model
 * id still appears under some upstream provider.
 */
export function findModelInfo(
  catalog: ModelsCatalog,
  modelId: string,
  providerId?: string,
): ModelInfo | undefined {
  if (providerId) {
    const aliased = PROVIDER_ALIASES[providerId] ?? providerId;
    const hit = catalog[aliased]?.models[modelId] ?? catalog[providerId]?.models[modelId];
    if (hit) return hit;
  }
  for (const provider of Object.values(catalog)) {
    const hit = provider.models[modelId];
    if (hit) return hit;
  }
  return undefined;
}

export function maxContextTokensFrom(
  catalog: ModelsCatalog,
  modelId: string,
  providerId?: string,
): number {
  return findModelInfo(catalog, modelId, providerId)?.limit?.context ?? FALLBACK_CONTEXT_TOKENS;
}

export function capabilitiesFrom(
  catalog: ModelsCatalog,
  modelId: string,
  providerId?: string,
): ModelCapabilities {
  const info = findModelInfo(catalog, modelId, providerId);
  const inputModalities = info?.modalities?.input ?? [];
  return {
    contextTokens: info?.limit?.context,
    outputTokens: info?.limit?.output,
    // attachment is the coarse flag; image in modalities is the explicit signal.
    vision: Boolean(info?.attachment) || inputModalities.includes('image'),
    toolCall: Boolean(info?.tool_call),
    reasoning: Boolean(info?.reasoning),
    inputModalities,
    outputModalities: info?.modalities?.output ?? [],
  };
}
