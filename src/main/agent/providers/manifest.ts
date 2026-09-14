/**
 * Who Atrium ships an entry for, and what to call them.
 *
 * Nothing here says what a provider serves or how to reach it: models come
 * from a catalog — the engine's, or one written beside the provider it belongs
 * to — and the endpoint is carried by the registered provider itself. What is
 * left is a name, a link to where the vendor explains itself, and the one
 * distinction that changes behaviour, which is how it is paid for.
 *
 * There is deliberately no description. A sentence Atrium writes about someone
 * else's product is out of date the week they change it, and the console link
 * goes to the version that isn't.
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
  /**
   * The vendor's own name for the thing, matching what the engine calls it
   * where the engine ships one. A locale that says it differently overrides it
   * under `settings.providers.name.<id>`; everywhere else falls through to
   * this, since a brand rarely needs translating.
   */
  name: string;
  /** Where the user goes for a key, or to manage the subscription. */
  consoleUrl: string;
};

export const PROVIDER_MANIFEST: readonly ProviderManifest[] = [
  // ── Cloud API ────────────────────────────────────────────────────────────
  {
    id: 'anthropic',
    kind: 'cloud-api',
    name: 'Anthropic',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    kind: 'cloud-api',
    name: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    kind: 'cloud-api',
    name: 'DeepSeek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'google',
    kind: 'cloud-api',
    name: 'Google',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'moonshot',
    kind: 'cloud-api',
    name: 'Moonshot AI',
    consoleUrl: 'https://platform.kimi.com/console/api-keys',
  },
  {
    id: 'zai-coding',
    kind: 'cloud-api',
    name: 'Z.AI Coding',
    consoleUrl: 'https://open.bigmodel.cn/console/overview',
  },
  {
    id: 'volcengine-agent',
    kind: 'cloud-api',
    name: 'VolcEngine Ark - Agent Plan',
    consoleUrl: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan',
  },
  {
    id: 'volcengine-coding',
    kind: 'cloud-api',
    name: 'VolcEngine Ark - Coding Plan',
    consoleUrl: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan',
  },
  // ── Subscriptions (signed into, not keyed) ───────────────────────────────
  // A vendor that sells both a key and a subscription gets one row per
  // credential, not one row with two: the engine stores exactly one credential
  // per provider id, so the two cannot coexist under the same entry.
  {
    id: 'anthropic-subscription',
    kind: 'subscription',
    name: 'Claude Pro/Max',
    consoleUrl: 'https://claude.ai/settings/billing',
  },
  {
    id: 'openai-codex',
    kind: 'subscription',
    name: 'OpenAI Codex',
    consoleUrl: 'https://chatgpt.com/codex',
  },
  {
    id: 'openrouter',
    kind: 'cloud-api',
    name: 'OpenRouter',
    consoleUrl: 'https://openrouter.ai/keys',
  },
] as const;

export function getProviderManifest(id: string): ProviderManifest | undefined {
  return PROVIDER_MANIFEST.find((p) => p.id === id);
}
