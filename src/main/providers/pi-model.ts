import {
  type Api,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { providers } from '../db/schema';
import { decryptCredentials } from './credentials';
import { getProviderManifest, type ManifestModel, PROVIDER_MANIFEST } from './manifest';

/**
 * pi-side model resolution, the counterpart of resolveModel (AI SDK) — both
 * coexist until the engine swap completes, then the AI SDK path retires.
 *
 * Model metadata comes from pi itself, not the litellm catalog: the builtin
 * entry when pi ships the provider (compat quirks included); otherwise the
 * same model id borrowed from a registered builtin catalog (aggregators like
 * aihubmix serve openai/anthropic/google models under their own roof); then
 * the manifest entry's declared fields; then hard defaults.
 *
 * baseUrl follows pi's convention — no path suffix (the api modules append
 * their own: /chat/completions, /v1/messages). Stored overrides are used
 * verbatim; validating what the user types is the settings panel's job.
 */

const PROTOCOL_API = {
  anthropic: 'anthropic-messages',
  'openai-compatible': 'openai-completions',
  'google-gemini': 'google-generative-ai',
} as const;

const API_STREAMS = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-completions': openAICompletionsApi,
  'google-generative-ai': googleGenerativeAIApi,
} as const;

/**
 * The registry pi's streamSimple dispatches through — it refuses providers it
 * doesn't know, so registration is static and happens once at module load:
 * the pi builtin providers Atrium ships UI for (their maintained catalogs also
 * feed metadata), plus one same-protocol provider per remaining manifest entry
 * (relays and local services — empty model list; keys arrive per call via
 * getApiKey, so the env-var auth never fires).
 */
export const piModels = createModels();

for (const provider of [
  anthropicProvider(),
  openaiProvider(),
  deepseekProvider(),
  googleProvider(),
]) {
  piModels.setProvider(provider);
}

for (const manifest of PROVIDER_MANIFEST) {
  if (piModels.getProvider(manifest.id)) continue;
  const api =
    manifest.kind === 'cloud-api'
      ? PROTOCOL_API[manifest.protocol]
      : manifest.kind === 'local-service'
        ? 'openai-completions'
        : undefined;
  if (!api) continue;
  piModels.setProvider(
    createProvider({
      id: manifest.id,
      name: manifest.name,
      auth: { apiKey: envApiKeyAuth(`${manifest.name} API key`, []) },
      models: [],
      api: API_STREAMS[api](),
    }),
  );
}

export const piStreamFn = piModels.streamSimple.bind(piModels);

function configuredBaseUrl(db: Db, providerId: string): string | undefined {
  const row = db
    .select({ config: providers.config })
    .from(providers)
    .where(eq(providers.id, providerId))
    .get();
  return (row?.config as { baseUrl?: string } | null)?.baseUrl?.trim() || undefined;
}

export function resolvePiModel(db: Db, providerId: string, modelId: string): Model<Api> {
  const manifest = getProviderManifest(providerId);
  if (!manifest) throw new Error(`Provider "${providerId}" is unknown.`);

  if (manifest.kind === 'local-service') {
    const base = (configuredBaseUrl(db, providerId) ?? manifest.defaultBaseUrl).replace(/\/+$/, '');
    return buildModel(providerId, modelId, 'openai-completions', `${base}/v1`);
  }
  if (manifest.kind !== 'cloud-api') {
    throw new Error(`Provider "${providerId}" is not a model provider.`);
  }

  const override = configuredBaseUrl(db, providerId);

  // A builtin entry under a builtin provider is complete as-is (its api has
  // registered streams, compat and cost are pi-maintained).
  const builtin = piModels.getModel(providerId, modelId);
  if (builtin) return override ? { ...builtin, baseUrl: override } : builtin;

  return buildModel(
    providerId,
    modelId,
    PROTOCOL_API[manifest.protocol],
    override ?? manifest.defaultBaseUrl,
    manifest.models.find((m) => m.id === modelId),
  );
}

/** Origin vendors ordered for metadata borrowing; only registered catalogs
 *  (the builtin four) are searched, so relay re-listings never collide. */
const BORROW_PREFERENCE = ['openai', 'anthropic', 'google', 'deepseek'];

/** The same model id in a registered builtin catalog — how an aggregator's
 *  models inherit cost/window/modalities pi already maintains. Same-api
 *  entries win (compat transfers), then vendor order. */
function borrowBuiltinEntry(modelId: string, api: Api): Model<Api> | undefined {
  const candidates = piModels.getModels().filter((m) => m.id === modelId);
  if (candidates.length === 0) return undefined;
  const rank = (m: Model<Api>): number => {
    if (m.api === api) return 0;
    const at = BORROW_PREFERENCE.indexOf(m.provider);
    return at === -1 ? BORROW_PREFERENCE.length + 1 : at + 1;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0];
}

function buildModel(
  providerId: string,
  modelId: string,
  api: Api,
  baseUrl: string,
  declared?: ManifestModel,
): Model<Api> {
  const borrowed = borrowBuiltinEntry(modelId, api);
  // compat and thinking maps are api-specific; they only transfer when the
  // borrowed entry speaks the same api we do.
  const base = borrowed?.api === api ? borrowed : undefined;
  return {
    ...base,
    id: modelId,
    name: borrowed?.name ?? modelId,
    api,
    provider: providerId,
    baseUrl,
    reasoning: declared?.reasoning ?? borrowed?.reasoning ?? false,
    input:
      declared?.vision != null
        ? declared.vision
          ? ['text', 'image']
          : ['text']
        : (borrowed?.input ?? ['text']),
    cost: borrowed?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: declared?.contextTokens ?? borrowed?.contextWindow ?? 128_000,
    maxTokens: declared?.outputTokens ?? borrowed?.maxTokens ?? 8192,
  } as Model<Api>;
}

/** Per-call key resolution for pi's getApiKey hook; undefined = keyless. */
export function makeGetApiKey(db: Db): (provider: string) => string | undefined {
  return (provider) => {
    const manifest = getProviderManifest(provider);
    if (manifest?.kind !== 'cloud-api') return undefined;
    const row = db
      .select({ blob: providers.credentialsEncrypted })
      .from(providers)
      .where(eq(providers.id, provider))
      .get();
    if (!row?.blob) return undefined;
    return decryptCredentials<{ key: string }>(row.blob).key;
  };
}
