/**
 * Who Atrium ships an entry for, and what to call them.
 *
 * Nothing here says what a provider serves or how to reach it: models come
 * from a catalog — the engine's, or one written beside the provider it belongs
 * to — and the endpoint is carried by the registered provider itself. What is
 * left is what the settings panel needs to offer one, plus the one distinction
 * that changes behaviour, which is how it is paid for.
 *
 * Keeping the copy here rather than in the `providers` table means it can be
 * updated in a release without a migration, and the table holds only what the
 * user chose. `descriptionKey` is an i18n key, so this stays free of localized
 * strings.
 */

/**
 * How a provider is paid for, which is the only thing that changes how Atrium
 * treats one. A subscription is signed into instead of keyed: the engine owns
 * the whole auth flow, and the vendor's catalog is fixed — there is nothing to
 * add to it and nothing to pick from it.
 */
export type ProviderKind = 'cloud-api' | 'subscription';

export type ProviderManifest = {
  id: string;
  kind: ProviderKind;
  name: string;
  descriptionKey: string;
  /** Where the user goes for a key, or to manage the subscription. */
  consoleUrl: string;
};

export const PROVIDER_MANIFEST: readonly ProviderManifest[] = [
  // ── Cloud API ────────────────────────────────────────────────────────────
  {
    id: 'anthropic',
    kind: 'cloud-api',
    name: 'Anthropic',
    descriptionKey: 'settings.providers.desc.anthropic',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    kind: 'cloud-api',
    name: 'OpenAI',
    descriptionKey: 'settings.providers.desc.openai',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    kind: 'cloud-api',
    name: 'DeepSeek',
    descriptionKey: 'settings.providers.desc.deepseek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'google',
    kind: 'cloud-api',
    name: 'Google Gemini',
    descriptionKey: 'settings.providers.desc.google',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'moonshot',
    kind: 'cloud-api',
    name: 'Moonshot',
    descriptionKey: 'settings.providers.desc.moonshot',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'kimi-coding',
    kind: 'cloud-api',
    name: 'Kimi Coding Plan',
    descriptionKey: 'settings.providers.desc.kimiCoding',
    consoleUrl: 'https://platform.moonshot.cn/',
  },
  {
    id: 'zai-coding',
    kind: 'cloud-api',
    name: 'Z.AI Coding Plan',
    descriptionKey: 'settings.providers.desc.zaiCoding',
    consoleUrl: 'https://open.bigmodel.cn/',
  },
  {
    id: 'volcengine-agent',
    kind: 'cloud-api',
    name: 'Volcengine Agent Plan',
    descriptionKey: 'settings.providers.desc.volcengineAgent',
    consoleUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=agentPlan',
  },
  {
    id: 'volcengine-coding',
    kind: 'cloud-api',
    name: 'Volcengine Coding Plan',
    descriptionKey: 'settings.providers.desc.volcengineCoding',
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
    consoleUrl: 'https://openrouter.ai/keys',
  },
] as const;

export function getProviderManifest(id: string): ProviderManifest | undefined {
  return PROVIDER_MANIFEST.find((p) => p.id === id);
}
