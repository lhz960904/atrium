/**
 * Who Atrium ships an entry for, and what to call them.
 *
 * Nothing here says what a provider serves or how to reach it: models come
 * from a catalog — the engine's, or one written beside the provider it belongs
 * to — and the endpoint is carried by the registered provider itself. What is
 * left is a name, a link to where the vendor explains itself, and the one
 * distinction that changes behaviour, which is how the user connects it.
 *
 * There is deliberately no description. A sentence Atrium writes about someone
 * else's product is out of date the week they change it, and the console link
 * goes to the version that isn't.
 */

/**
 * How the user connects a provider, which decides the settings form and what a
 * model pick means. An OAuth provider is signed into and the engine owns the
 * whole flow, so its catalog is granted whole until the user narrows it; an
 * API-key provider offers only the models the user turns on.
 */
export type ProviderAuthMode = 'api-key' | 'oauth';

export type ProviderManifest = {
  id: string;
  authMode: ProviderAuthMode;
  /**
   * The vendor's own name for the thing, matching what the engine calls it
   * where the engine ships one. A locale that says it differently overrides it
   * under `settings.providers.name.<id>`; everywhere else falls through to
   * this, since a brand rarely needs translating.
   */
  name: string;
  /** Where the user goes for a key, or to manage the account they sign in with. */
  consoleUrl: string;
};

export const PROVIDER_MANIFEST: readonly ProviderManifest[] = [
  // ── API key ──────────────────────────────────────────────────────────────
  {
    id: 'anthropic',
    authMode: 'api-key',
    name: 'Anthropic',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    authMode: 'api-key',
    name: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    authMode: 'api-key',
    name: 'DeepSeek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'google',
    authMode: 'api-key',
    name: 'Google',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'moonshotai-cn',
    authMode: 'api-key',
    name: 'Moonshot AI',
    consoleUrl: 'https://platform.kimi.com/console/api-keys',
  },
  {
    id: 'zai-coding-cn',
    authMode: 'api-key',
    name: 'Z.AI Coding',
    consoleUrl: 'https://open.bigmodel.cn/console/overview',
  },
  {
    id: 'volcengine-agent',
    authMode: 'api-key',
    name: 'VolcEngine Ark - Agent Plan',
    consoleUrl: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan',
  },
  {
    id: 'volcengine-coding',
    authMode: 'api-key',
    name: 'VolcEngine Ark - Coding Plan',
    consoleUrl: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan',
  },
  {
    id: 'openrouter',
    authMode: 'api-key',
    name: 'OpenRouter',
    consoleUrl: 'https://openrouter.ai/keys',
  },
  // ── OAuth (signed into, not keyed) ───────────────────────────────────────
  // A vendor that sells both a key and a subscription gets one row per
  // credential, not one row with two: the engine stores exactly one credential
  // per provider id, so the two cannot coexist under the same entry.
  {
    id: 'anthropic-subscription',
    authMode: 'oauth',
    name: 'Claude Pro/Max',
    consoleUrl: 'https://claude.ai/settings/billing',
  },
  {
    id: 'openai-codex',
    authMode: 'oauth',
    name: 'OpenAI Codex',
    consoleUrl: 'https://chatgpt.com/codex',
  },
] as const;

export function getProviderManifest(id: string): ProviderManifest | undefined {
  return PROVIDER_MANIFEST.find((p) => p.id === id);
}
