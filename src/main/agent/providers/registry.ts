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
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';
import type { Db } from '@main/db';
import { readCustomProviders, type StoredCustomProvider } from './custom-providers';
import { volcengineAgentProviderConfig, volcengineCodingProviderConfig } from './volcengine';

/**
 * The engine's provider registry.
 *
 * One (provider, model) pair has exactly one catalog entry, and nothing is
 * inferred across providers: the entry pi ships for its own providers, the
 * entry Atrium writes for an endpoint pi doesn't cover, or the one the user
 * wrote on a provider they defined. A model id appearing under two providers is
 * two independent records, because two endpoints serving the same id routinely
 * differ in window and price.
 *
 * baseUrl follows pi's convention: no path suffix, since each api module
 * appends its own.
 */

const API_STREAMS = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-completions': openAICompletionsApi,
  'google-generative-ai': googleGenerativeAIApi,
} as const;

/**
 * The engine's credential storage, and the only path a request's key or OAuth
 * token comes from. Resolved lazily: the registry is assembled at module load
 * (before the database is open), while a credential is only ever read when a
 * request is actually made.
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

/** Everything registering a provider Atrium maintains itself takes. */
type OwnProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  api: keyof typeof API_STREAMS;
  models: readonly Model<Api>[];
};

/**
 * Providers Atrium maintains itself, for endpoints the engine doesn't ship and
 * that expose no listing of their own. Each vendor's file owns its endpoint,
 * request format and catalog; this list only gathers them.
 */
const OWN_PROVIDERS = [
  volcengineAgentProviderConfig,
  volcengineCodingProviderConfig,
] satisfies readonly OwnProviderConfig[];

/** Every provider Atrium ships, before anything the user has added. */
const BUILTIN_PROVIDERS: readonly Provider[] = (() => {
  const engine: Provider[] = [
    anthropic,
    openaiProvider(),
    deepseekProvider(),
    googleProvider(),
    moonshotaiCnProvider(),
    zaiCodingCnProvider(),
    openrouterProvider(),
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

  const own = OWN_PROVIDERS.map(({ api, ...config }) =>
    createProvider({
      ...config,
      auth: { apiKey: envApiKeyAuth(`${config.name} API key`, []) },
      api: API_STREAMS[api](),
    }),
  );

  return [...engine, ...own];
})();

/** A provider that exists only because the user defined it: the endpoint and
 *  the request format are theirs, and so is every model on it. */
function customProvider(id: string, { definition, models }: StoredCustomProvider): Provider {
  return createProvider({
    id,
    name: definition.name,
    baseUrl: definition.baseUrl,
    auth: { apiKey: envApiKeyAuth(`${definition.name} API key`, []) },
    models: models.map((model) => ({
      ...model,
      provider: id,
      baseUrl: model.baseUrl ?? definition.baseUrl,
      api: definition.api,
    })),
    api: API_STREAMS[definition.api](),
  });
}

function syncRegistry(custom: ReadonlyMap<string, StoredCustomProvider>): void {
  for (const provider of BUILTIN_PROVIDERS) piModels.setProvider(provider);
  const builtin = new Set(BUILTIN_PROVIDERS.map((provider) => provider.id));
  for (const [id, catalog] of custom) {
    // A defined id that collides with a built-in one is ignored rather than
    // allowed to shadow it: threads already name that id.
    if (!builtin.has(id)) piModels.setProvider(customProvider(id, catalog));
  }
  // A provider the user deleted has to leave the registry too — it holds a
  // snapshot, so an unregistered id would keep answering until restart.
  for (const provider of piModels.getProviders()) {
    if (!builtin.has(provider.id) && !custom.has(provider.id)) {
      piModels.deleteProvider(provider.id);
    }
  }
}

// The registry has to answer before the database is open — a scheduled run can
// resolve a model during startup — so it starts at what Atrium ships and is
// rebuilt once the providers the user defined are readable.
syncRegistry(new Map());

/**
 * Rebuild the registry from what the user has stored. Called once the database
 * is open and again after anything changes a defined provider or its models,
 * because the registry is a snapshot: a provider it already holds keeps its old
 * catalog until it is set again.
 */
export function refreshProviders(db: Db): void {
  syncRegistry(readCustomProviders(db));
}

export const piStreamFn = piModels.streamSimple.bind(piModels);
