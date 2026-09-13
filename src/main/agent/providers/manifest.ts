/**
 * Static metadata for every well-known provider Atrium can talk to.
 *
 * The `providers` table only stores the user's runtime configuration
 * (enabled flag, base URL, visible models, encrypted credentials). Display
 * name, kind, default endpoints, console URLs, etc. live here so the table
 * stays minimal and we can ship updated copy without a schema migration.
 *
 * `descriptionKey` is an i18n key (not display text): the renderer translates
 * it, keeping this main-side catalog free of localized strings.
 */

export type ProviderKind = 'cloud-api' | 'local-service' | 'subscription';
export type CloudApiProtocol = 'anthropic' | 'openai-compatible' | 'google-gemini';

/**
 * A model a provider is known to serve. An id and nothing else: window,
 * price and capabilities belong to the catalog entry the engine resolves,
 * where one (provider, model) pair has exactly one record. This list only
 * says which ids to offer for a provider whose endpoint can't be asked.
 */
export type ManifestModel = { id: string };

export type CloudApiManifest = {
  id: string;
  kind: 'cloud-api';
  name: string;
  descriptionKey: string;
  /** Decides how the `/models` listing request is shaped + parsed. */
  protocol: CloudApiProtocol;
  defaultBaseUrl: string;
  /** Where the user goes to generate their API key. */
  consoleUrl: string;
  /** Models Atrium knows about for this provider; user toggles a subset on. */
  models: readonly ManifestModel[];
};

/**
 * A model server running on the user's machine (Ollama). Speaks the
 * openai-compatible protocol on a localhost port — no API key, no spawned
 * process; Atrium just detects whether the service is up and talks HTTP.
 * Endpoint paths (health probe, model listing) live with the service's API
 * knowledge in local-service.ts — the manifest only carries what varies or is
 * user-facing.
 */
export type LocalServiceManifest = {
  id: string;
  kind: 'local-service';
  name: string;
  descriptionKey: string;
  defaultBaseUrl: string;
};

/**
 * A vendor subscription the user signs into instead of pasting a key. The
 * engine owns the whole flow (authorization URL, token exchange, refresh); the
 * manifest only says which provider offers one and where to read about it.
 */
export type SubscriptionManifest = {
  id: string;
  kind: 'subscription';
  name: string;
  descriptionKey: string;
  /** Where the user manages the subscription itself. */
  consoleUrl: string;
};

export type ProviderManifest = CloudApiManifest | LocalServiceManifest | SubscriptionManifest;

export const PROVIDER_MANIFEST: readonly ProviderManifest[] = [
  // ── Cloud API ────────────────────────────────────────────────────────────
  {
    id: 'anthropic',
    kind: 'cloud-api',
    name: 'Anthropic',
    descriptionKey: 'settings.providers.desc.anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    models: [{ id: 'claude-opus-4-7' }, { id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }],
  },
  {
    id: 'openai',
    kind: 'cloud-api',
    name: 'OpenAI',
    descriptionKey: 'settings.providers.desc.openai',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
    models: [{ id: 'gpt-5' }, { id: 'gpt-4.1' }, { id: 'o4-mini' }],
  },
  {
    id: 'deepseek',
    kind: 'cloud-api',
    name: 'DeepSeek',
    descriptionKey: 'settings.providers.desc.deepseek',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
  },
  {
    id: 'google',
    kind: 'cloud-api',
    name: 'Google Gemini',
    descriptionKey: 'settings.providers.desc.google',
    protocol: 'google-gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    consoleUrl: 'https://aistudio.google.com/apikey',
    models: [{ id: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }],
  },
  {
    id: 'moonshot',
    kind: 'cloud-api',
    name: 'Moonshot',
    descriptionKey: 'settings.providers.desc.moonshot',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [{ id: 'moonshot-v1-128k' }, { id: 'moonshot-v1-32k' }],
  },
  {
    id: 'kimi-coding',
    kind: 'cloud-api',
    name: 'Kimi Coding Plan',
    descriptionKey: 'settings.providers.desc.kimiCoding',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.moonshot.cn/anthropic',
    consoleUrl: 'https://platform.moonshot.cn/',
    models: [{ id: 'kimi-k2' }],
  },
  {
    id: 'zai-coding',
    kind: 'cloud-api',
    name: 'Z.AI Coding Plan',
    descriptionKey: 'settings.providers.desc.zaiCoding',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    consoleUrl: 'https://open.bigmodel.cn/',
    models: [{ id: 'glm-4.6' }],
  },
  {
    id: 'volcengine-agent',
    kind: 'cloud-api',
    name: 'Volcengine Agent Plan',
    descriptionKey: 'settings.providers.desc.volcengineAgent',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
    consoleUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=agentPlan',
    // The plan endpoint has no model-listing API; this is the doc's supported
    // text-generation set (each id verified against the live endpoint).
    models: [
      { id: 'ark-code-latest' },
      { id: 'doubao-seed-2.0-mini' },
      { id: 'doubao-seed-2.0-lite' },
      { id: 'doubao-seed-2.0-code' },
      { id: 'doubao-seed-2.0-pro' },
      { id: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro' },
      { id: 'minimax-m2.7' },
      { id: 'minimax-m3' },
      { id: 'glm-5.2' },
      { id: 'kimi-k2.6' },
      { id: 'kimi-k2.7-code' },
    ],
  },
  {
    id: 'volcengine-coding',
    kind: 'cloud-api',
    name: 'Volcengine Coding Plan',
    descriptionKey: 'settings.providers.desc.volcengineCoding',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    consoleUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=subscribe',
    // Like the agent plan: no model-listing API, doc's text-generation set.
    models: [
      { id: 'ark-code-latest' },
      { id: 'doubao-seed-code' },
      { id: 'doubao-seed-2.0-code' },
      { id: 'doubao-seed-2.0-lite' },
      { id: 'doubao-seed-2.0-pro' },
      { id: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro' },
      { id: 'minimax-m2.7' },
      { id: 'minimax-m3' },
      { id: 'glm-5.2' },
      { id: 'kimi-k2.6' },
      { id: 'kimi-k2.7-code' },
    ],
  },
  // ── Subscriptions (signed into, not keyed) ───────────────────────────────
  // A vendor that sells both a key and a subscription gets one row per
  // credential, not one row with two: the engine stores exactly one credential
  // per provider id, so the two cannot coexist under the same entry.
  {
    id: 'anthropic-subscription',
    kind: 'subscription',
    name: 'Claude Pro/Max',
    descriptionKey: 'settings.providers.desc.anthropicSubscription',
    consoleUrl: 'https://claude.ai/settings/billing',
  },
  {
    id: 'openai-codex',
    kind: 'subscription',
    name: 'OpenAI Codex',
    descriptionKey: 'settings.providers.desc.openaiCodex',
    consoleUrl: 'https://chatgpt.com/codex',
  },
  {
    id: 'openrouter',
    kind: 'cloud-api',
    name: 'OpenRouter',
    descriptionKey: 'settings.providers.desc.openrouter',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    consoleUrl: 'https://openrouter.ai/keys',
    models: [],
  },
  {
    id: 'aihubmix',
    kind: 'cloud-api',
    name: 'AiHubMix',
    descriptionKey: 'settings.providers.desc.aihubmix',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://aihubmix.com/v1',
    consoleUrl: 'https://aihubmix.com/',
    models: [],
  },
  // ── Local services ───────────────────────────────────────────────────────
  {
    id: 'ollama',
    kind: 'local-service',
    name: 'Ollama',
    descriptionKey: 'settings.providers.desc.ollama',
    defaultBaseUrl: 'http://localhost:11434',
  },
] as const;

export function getProviderManifest(id: string): ProviderManifest | undefined {
  return PROVIDER_MANIFEST.find((p) => p.id === id);
}
