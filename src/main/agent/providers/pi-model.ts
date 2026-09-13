import {
  type Api,
  type CredentialStore,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { decryptJson } from '@main/platform/safe-storage';
import type { CustomModel, CustomProvider } from '@shared/custom-model';
import { eq } from 'drizzle-orm';
import { readAddedModels, readCustomProviders } from './custom-models';
import {
  type CloudApiManifest,
  getProviderManifest,
  type LocalServiceManifest,
  PROVIDER_MANIFEST,
} from './manifest';
import { adoptRetiredProviders } from './retired';
import { arkAgentPlanModels, arkCodingPlanModels } from './volcengine.models';

/**
 * Model resolution for the engine.
 *
 * One (provider, model) pair has exactly one catalog entry, and nothing is
 * inferred across providers: the entry pi ships for its own providers, the
 * entry Atrium writes for an endpoint pi doesn't cover, then the provider's
 * own manifest declaration, then a deliberately small default. A model id
 * appearing under two providers is two independent records, because two
 * endpoints serving the same id routinely differ in window and price.
 *
 * baseUrl follows pi's convention — no path suffix (the api modules append
 * their own: /chat/completions, /v1/messages). Stored overrides are used
 * verbatim; validating what the user types is the settings panel's job.
 */

/** Conservative defaults for an id no catalog covers — small enough to fold
 *  early rather than overflow, since overflowing fails silently. */
const FALLBACK_CONTEXT_TOKENS = 128_000;
const FALLBACK_MAX_TOKENS = 8192;

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

/**
 * Serve an engine-maintained catalog under the id Atrium already uses. A
 * provider id is written into every stored thread and credential row, so it
 * can't follow the engine's naming — but the catalog behind it can.
 *
 * The engine's provider is wrapped rather than rebuilt: only the identity and
 * the model list are ours, while streaming, headers and auth stay whatever it
 * configured for that endpoint. Models are re-stamped because a request routes
 * on the model's own `provider`, which also decides the credential it resolves.
 */
function adopt(source: Provider, id: string, name: string): Provider {
  const models = source.getModels().map((model) => ({ ...model, provider: id }));
  return {
    ...source,
    id,
    name,
    getModels: () => models,
    stream: (model, context, options) => source.stream(model, context, options),
    streamSimple: (model, context, options) => source.streamSimple(model, context, options),
  };
}

/** Catalogs Atrium maintains itself, for endpoints the engine doesn't ship and
 *  that expose no listing of their own. */
const OWN_CATALOG: Record<string, (baseUrl: string) => Model<'anthropic-messages'>[]> = {
  'volcengine-agent': arkAgentPlanModels,
  'volcengine-coding': arkCodingPlanModels,
};

/** Every provider Atrium ships, before anything the user has added. */
const SHIPPED: readonly Provider[] = (() => {
  const engine: Provider[] = [
    anthropic,
    openaiProvider(),
    deepseekProvider(),
    googleProvider(),
    // Same endpoint and protocol as the manifest already declared, so adopting
    // the engine's catalog only adds the metadata we had no source for.
    adopt(moonshotaiCnProvider(), 'moonshot', 'Moonshot'),
    adopt(zaiCodingCnProvider(), 'zai-coding', 'Z.AI Coding Plan'),
    openrouterProvider(),
    kimiCodingProvider(),
    // Subscriptions the user signs into; their catalogs and auth are pi's.
    openaiCodexProvider(),
    /**
     * Claude Pro/Max as its own provider, reusing Anthropic's OAuth flow,
     * models and endpoint. pi offers both auth kinds under one provider, but a
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
      models: anthropic
        .getModels()
        .map((model) => ({ ...model, provider: SUBSCRIPTION_ANTHROPIC })),
      api: anthropicMessagesApi(),
    }),
  ];

  const known = new Set(engine.map((p) => p.id));
  const rest = PROVIDER_MANIFEST.filter(
    (m): m is CloudApiManifest | LocalServiceManifest =>
      !known.has(m.id) && m.kind !== 'subscription',
  ).map((manifest) => {
    const api =
      manifest.kind === 'cloud-api' ? PROTOCOL_API[manifest.protocol] : 'openai-completions';
    // Carrying the endpoint on the provider is what lets everything downstream
    // ask the registry for it instead of reading the manifest a second time.
    const baseUrl = manifest.defaultBaseUrl;
    return createProvider({
      id: manifest.id,
      name: manifest.name,
      baseUrl,
      auth: { apiKey: envApiKeyAuth(`${manifest.name} API key`, []) },
      models: OWN_CATALOG[manifest.id]?.(baseUrl) ?? [],
      api: API_STREAMS[api](),
    });
  });

  return [...engine, ...rest];
})();

/**
 * A shipped provider with the user's own models folded into its catalog. An
 * added model replaces a catalog entry of the same id rather than sitting
 * behind it — that is what makes correcting a wrong window possible, and it
 * avoids an entry that can never be resolved.
 */
function withAddedModels(base: Provider, added: readonly CustomModel[]): Provider {
  const byId = new Map<string, Model<Api>>(base.getModels().map((m) => [m.id, m]));
  for (const model of added) {
    byId.set(model.id, {
      ...model,
      provider: base.id,
      // An added model follows the provider's endpoint unless it names its own,
      // so changing the endpoint doesn't strand it on a stale copy.
      baseUrl: model.baseUrl ?? base.baseUrl ?? '',
    });
  }
  const models = [...byId.values()];
  return {
    ...base,
    getModels: () => models,
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, options),
  };
}

/** A provider that exists only because the user defined it: the endpoint and
 *  the request format are theirs, and so is every model on it. */
function userProvider(id: string, def: CustomProvider, models: readonly CustomModel[]): Provider {
  return createProvider({
    id,
    name: def.name,
    baseUrl: def.baseUrl,
    auth: { apiKey: envApiKeyAuth(`${def.name} API key`, []) },
    models: models.map((model) => ({
      ...model,
      provider: id,
      baseUrl: model.baseUrl ?? def.baseUrl,
      api: def.api,
    })),
    api: API_STREAMS[def.api](),
  });
}

function registerAll(
  added: ReadonlyMap<string, readonly CustomModel[]>,
  defined: ReadonlyMap<string, CustomProvider> = new Map(),
): void {
  for (const base of SHIPPED) {
    const extra = added.get(base.id);
    piModels.setProvider(extra?.length ? withAddedModels(base, extra) : base);
  }
  const shipped = new Set(SHIPPED.map((p) => p.id));
  for (const [id, def] of defined) {
    // A user-defined id that collides with a shipped one is ignored rather
    // than allowed to shadow it: threads already name that id.
    if (shipped.has(id)) continue;
    piModels.setProvider(userProvider(id, def, added.get(id) ?? []));
  }
  // A provider the user deleted has to leave the registry too — it holds a
  // snapshot, so an unregistered id would keep answering until restart.
  for (const provider of piModels.getProviders()) {
    if (!shipped.has(provider.id) && !defined.has(provider.id)) {
      piModels.deleteProvider(provider.id);
    }
  }
}

// The registry has to answer before the database is open — a scheduled run can
// resolve a model during startup — so it starts at what Atrium ships and is
// rebuilt once the stored additions are readable.
registerAll(new Map());

/**
 * Rebuild the registry from what the user has stored. Called once the database
 * is open and again after anything changes a provider's models, because the
 * registry is a snapshot: a provider it already holds keeps its old catalog
 * until it is set again.
 */
export function refreshProviders(db: Db): void {
  adoptRetiredProviders(db);
  registerAll(readAddedModels(db), readCustomProviders(db));
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
  if (!manifest) {
    // No manifest entry means the user defined this provider. Its catalog is
    // entirely theirs, so the registry is the whole answer.
    const model = piModels.getModel(providerId, modelId);
    if (!model) throw new Error(`Provider "${providerId}" is unknown.`);
    const override = configuredBaseUrl(db, providerId);
    return override ? { ...model, baseUrl: override } : model;
  }

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
  );
}

/**
 * A model nobody has a catalog entry for. Metadata is never inferred from
 * another provider serving the same id: an aggregator or a subscription plan
 * routinely serves a model at a different window and a different price than
 * its origin vendor, and inheriting the origin's numbers is wrong in the
 * direction that fails silently — an over-large window is truncated, not
 * rejected, and an origin's per-token rate misprices a plan that charges none.
 *
 * So the endpoint is addressable and nothing about the model is claimed.
 */
function buildModel(providerId: string, modelId: string, api: Api, baseUrl: string): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api,
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: FALLBACK_CONTEXT_TOKENS,
    maxTokens: FALLBACK_MAX_TOKENS,
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
    return decryptJson<{ key: string }>(row.blob).key;
  };
}
