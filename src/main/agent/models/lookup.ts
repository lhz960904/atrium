import { type ManifestModel, PROVIDER_MANIFEST } from '../../providers/manifest';
import type { Modality, ModelCapabilities, ModelInfo, ModelPricing, ModelsCatalog } from './types';

/** Conservative window for ids the dataset doesn't know — compact early, never overflow. */
export const FALLBACK_CONTEXT_TOKENS = 128_000;

const MODALITIES = new Set<Modality>(['text', 'image', 'audio', 'video', 'pdf']);
const toModalities = (list?: string[]): Modality[] =>
  (list ?? []).filter((m): m is Modality => MODALITIES.has(m as Modality));

/** The bare model name: the segment after the last `/`, lowercased. */
const bareName = (id: string): string => id.slice(id.lastIndexOf('/') + 1).toLowerCase();

function declaredInfo(model: ManifestModel): ModelInfo | undefined {
  const info: ModelInfo = {};
  if (model.contextTokens != null) info.max_input_tokens = model.contextTokens;
  if (model.outputTokens != null) info.max_output_tokens = model.outputTokens;
  if (model.vision != null) info.supports_vision = model.vision;
  if (model.toolCall != null) info.supports_function_calling = model.toolCall;
  if (model.reasoning != null) info.supports_reasoning = model.reasoning;
  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * Metadata declared on the provider manifest's models, keyed by bare name.
 * A declaration is the vendor's documented truth for the exact endpoint we
 * ship — litellm's bare-name join can miss (Ark plan ids) or land on another
 * vendor's variant of the same model — so declared fields override the litellm
 * entry, while undeclared fields still resolve through it.
 */
const MANIFEST_OVERLAY: Record<string, ModelInfo> = {};
/** Vendor serving id (bare) → the litellm key its metadata lives under. */
const MANIFEST_CATALOG_ID: Record<string, string> = {};
for (const provider of PROVIDER_MANIFEST) {
  if (provider.kind !== 'cloud-api') continue;
  for (const model of provider.models) {
    const info = declaredInfo(model);
    if (info) MANIFEST_OVERLAY[bareName(model.id)] = info;
    if (model.catalogId) MANIFEST_CATALOG_ID[bareName(model.id)] = model.catalogId;
  }
}

/**
 * Resolve a model id to its litellm entry. An exact key hit wins; otherwise we
 * match on the bare model name (last `/`-segment, case-insensitive). Relays and
 * aggregators rewrite the prefix and casing freely — litellm keys Kimi as
 * `moonshot/kimi-k2.5`, while a relay serves `moonshotai/Kimi-K2.5` — so the
 * stable join key is the model name, not the vendor path. Same-name entries
 * across providers are the same model, so the first match's capabilities apply.
 * Fields declared in the provider manifest overlay whatever litellm has.
 */
export function findModelInfo(catalog: ModelsCatalog, modelId: string): ModelInfo | undefined {
  const target = bareName(modelId);
  if (modelId === 'sample_spec' || target === 'sample_spec') return undefined;

  let fromCatalog = catalog[modelId];
  if (!fromCatalog) {
    // A manifest-declared alias beats the scan: it names the exact litellm key.
    const aliasKey = MANIFEST_CATALOG_ID[target];
    if (aliasKey) fromCatalog = catalog[aliasKey];
  }
  if (!fromCatalog) {
    for (const [key, info] of Object.entries(catalog)) {
      if (key !== 'sample_spec' && bareName(key) === target) {
        fromCatalog = info;
        break;
      }
    }
  }
  const declared = MANIFEST_OVERLAY[target];
  if (fromCatalog && declared) return { ...fromCatalog, ...declared };
  return declared ?? fromCatalog;
}

export function maxContextTokensFrom(catalog: ModelsCatalog, modelId: string): number {
  const info = findModelInfo(catalog, modelId);
  return info?.max_input_tokens ?? info?.max_tokens ?? FALLBACK_CONTEXT_TOKENS;
}

export function modelPricingFrom(catalog: ModelsCatalog, modelId: string): ModelPricing {
  const info = findModelInfo(catalog, modelId);
  return {
    input: info?.input_cost_per_token ?? 0,
    output: info?.output_cost_per_token ?? 0,
    cacheRead: info?.cache_read_input_token_cost ?? 0,
    cacheCreation: info?.cache_creation_input_token_cost ?? 0,
  };
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
