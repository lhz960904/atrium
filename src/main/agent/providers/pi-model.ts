import {
  type Api,
  type CredentialStore,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { eq } from 'drizzle-orm';
import { decryptCredentials } from './credentials';
import { getProviderManifest, type ManifestModel, PROVIDER_MANIFEST } from './manifest';

/**
 * Model resolution for the engine.
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
/**
 * The engine's credential storage. Resolved lazily: the registry is assembled
 * at module load (before the database is open), while a credential is only ever
 * read when a request is actually made.
 */
let credentials: CredentialStore | undefined;

export function useCredentialStore(store: CredentialStore): void {
  credentials = store;
}

/**
 * pi loads each OAuth flow through a variable specifier so bundlers can't follow
 * it — which is exactly what breaks here: main is bundled to one file, and the
 * flow module has no chunk to import at login time. This entry point holds
 * static imports of every flow, so registering them up front is what makes
 * subscription login work in a bundled app at all.
 */
registerBunOAuthFlows();

export const piModels = createModels({
  credentials: {
    read: (id, o) => (credentials ? credentials.read(id, o) : Promise.resolve(undefined)),
    list: (o) => (credentials ? credentials.list(o) : Promise.resolve([])),
    modify: (id, fn, o) =>
      credentials ? credentials.modify(id, fn, o) : Promise.resolve(undefined),
    delete: (id, o) => (credentials ? credentials.delete(id, o) : Promise.resolve()),
  },
});

/** Claude Pro/Max, kept apart from the api-key entry so both credentials fit. */
const SUBSCRIPTION_ANTHROPIC = 'anthropic-subscription';

const anthropic = anthropicProvider();

for (const provider of [
  anthropic,
  openaiProvider(),
  deepseekProvider(),
  googleProvider(),
  // Subscriptions the user signs into; their catalogs and auth are pi's.
  openaiCodexProvider(),
  /**
   * Claude Pro/Max as its own provider, reusing Anthropic's OAuth flow, models
   * and endpoint. pi offers both auth kinds under one provider, but a
   * credential store holds exactly one credential per provider id — so a user
   * who has both a key and a subscription needs two entries, or signing in
   * would overwrite the key.
   */
  createProvider({
    id: SUBSCRIPTION_ANTHROPIC,
    name: 'Claude Pro/Max',
    baseUrl: anthropic.baseUrl,
    auth: { oauth: anthropic.auth.oauth },
    // Re-stamped: a request is routed by the model's own `provider`, so a
    // borrowed model would resolve auth against the api-key entry instead.
    models: anthropic.getModels().map((model) => ({ ...model, provider: SUBSCRIPTION_ANTHROPIC })),
    api: anthropicMessagesApi(),
  }),
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
  // A subscription's catalog is entirely pi's — nothing here to merge.
  if (manifest.kind === 'subscription') {
    const model = piModels.getModel(providerId, modelId);
    if (!model) throw new Error(`Model "${modelId}" is not offered by ${manifest.name}.`);
    return model;
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
