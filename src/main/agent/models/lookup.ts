import type { Modality, ModelCapabilities, ModelInfo, ModelsCatalog } from './types';

/** Conservative window for ids the dataset doesn't know — compact early, never overflow. */
export const FALLBACK_CONTEXT_TOKENS = 128_000;

const MODALITIES = new Set<Modality>(['text', 'image', 'audio', 'video', 'pdf']);
const toModalities = (list?: string[]): Modality[] =>
  (list ?? []).filter((m): m is Modality => MODALITIES.has(m as Modality));

/** The bare model name: the segment after the last `/`, lowercased. */
const bareName = (id: string): string => id.slice(id.lastIndexOf('/') + 1).toLowerCase();

/**
 * Resolve a model id to its litellm entry. An exact key hit wins; otherwise we
 * match on the bare model name (last `/`-segment, case-insensitive). Relays and
 * aggregators rewrite the prefix and casing freely — litellm keys Kimi as
 * `moonshot/kimi-k2.5`, while a relay serves `moonshotai/Kimi-K2.5` — so the
 * stable join key is the model name, not the vendor path. Same-name entries
 * across providers are the same model, so the first match's capabilities apply.
 */
export function findModelInfo(catalog: ModelsCatalog, modelId: string): ModelInfo | undefined {
  if (modelId !== 'sample_spec' && catalog[modelId]) return catalog[modelId];

  const target = bareName(modelId);
  if (target === 'sample_spec') return undefined;
  for (const [key, info] of Object.entries(catalog)) {
    if (key !== 'sample_spec' && bareName(key) === target) return info;
  }
  return undefined;
}

export function maxContextTokensFrom(catalog: ModelsCatalog, modelId: string): number {
  const info = findModelInfo(catalog, modelId);
  return info?.max_input_tokens ?? info?.max_tokens ?? FALLBACK_CONTEXT_TOKENS;
}

export function capabilitiesFrom(catalog: ModelsCatalog, modelId: string): ModelCapabilities {
  const info = findModelInfo(catalog, modelId);

  const inputModalities = toModalities(info?.supported_modalities);
  if (info?.supports_pdf_input && !inputModalities.includes('pdf')) inputModalities.push('pdf');

  const outputModalities = toModalities(info?.supported_output_modalities);
  // Image generators (gpt-image-2, dall-e, imagen, …) often omit output
  // modalities but carry mode=image_generation/image_edit — treat that as the
  // explicit image-output signal so image_gen model selection sees them.
  if (
    (info?.mode === 'image_generation' || info?.mode === 'image_edit') &&
    !outputModalities.includes('image')
  ) {
    outputModalities.push('image');
  }

  return {
    contextTokens: info?.max_input_tokens ?? info?.max_tokens,
    outputTokens: info?.max_output_tokens ?? info?.max_tokens,
    vision: Boolean(info?.supports_vision) || inputModalities.includes('image'),
    toolCall: Boolean(info?.supports_function_calling),
    reasoning: Boolean(info?.supports_reasoning),
    inputModalities,
    outputModalities,
  };
}
