/**
 * Static metadata for every well-known provider Atrium can talk to.
 *
 * No model lists live here. A provider the engine ships answers for its own
 * catalog; one it doesn't gets a catalog Atrium writes, next to the provider
 * it belongs to. There is no third case and nothing to merge.
 *
 * The `providers` table only stores the user's runtime configuration
 * (enabled flag, base URL, visible models, encrypted credentials). Display
 * name, kind, default endpoints, console URLs, etc. live here so the table
 * stays minimal and we can ship updated copy without a schema migration.
 *
 * `descriptionKey` is an i18n key (not display text): the renderer translates
 * it, keeping this main-side catalog free of localized strings.
 */

export type ProviderKind = 'cloud-api' | 'subscription';
export type CloudApiProtocol = 'anthropic' | 'openai-compatible' | 'google-gemini';

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

export type ProviderManifest = CloudApiManifest | SubscriptionManifest;

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
  },
  {
    id: 'openai',
    kind: 'cloud-api',
    name: 'OpenAI',
    descriptionKey: 'settings.providers.desc.openai',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    kind: 'cloud-api',
    name: 'DeepSeek',
    descriptionKey: 'settings.providers.desc.deepseek',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'google',
    kind: 'cloud-api',
    name: 'Google Gemini',
    descriptionKey: 'settings.providers.desc.google',
    protocol: 'google-gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'moonshot',
    kind: 'cloud-api',
    name: 'Moonshot',
    descriptionKey: 'settings.providers.desc.moonshot',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'kimi-coding',
    kind: 'cloud-api',
    name: 'Kimi Coding Plan',
    descriptionKey: 'settings.providers.desc.kimiCoding',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.kimi.com/coding',
    consoleUrl: 'https://platform.moonshot.cn/',
  },
  {
    id: 'zai-coding',
    kind: 'cloud-api',
    name: 'Z.AI Coding Plan',
    descriptionKey: 'settings.providers.desc.zaiCoding',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    consoleUrl: 'https://open.bigmodel.cn/',
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
  },
] as const;

export function getProviderManifest(id: string): ProviderManifest | undefined {
  return PROVIDER_MANIFEST.find((p) => p.id === id);
}
