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

export type ProviderKind = 'cloud-api' | 'local-cli';
export type CloudApiProtocol = 'anthropic' | 'openai-compatible' | 'google-gemini';

/**
 * How to launch a local CLI as an ACP agent. Some CLIs speak ACP natively (run
 * their own binary); others need the official ACP adapter package, whose bin we
 * resolve from node_modules.
 */
export type AcpLaunch =
  | { via: 'binary'; command: string; args: readonly string[] }
  | { via: 'adapter'; package: string; bin: string };

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
  models: readonly string[];
};

export type LocalCliManifest = {
  id: string;
  kind: 'local-cli';
  name: string;
  descriptionKey: string;
  acp: AcpLaunch;
  /** npm package the user global-installs (we don't bundle it) — shown as a hint. */
  install: string;
};

export type ProviderManifest = CloudApiManifest | LocalCliManifest;

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
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    kind: 'cloud-api',
    name: 'OpenAI',
    descriptionKey: 'settings.providers.desc.openai',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5', 'gpt-4.1', 'o4-mini'],
  },
  {
    id: 'deepseek',
    kind: 'cloud-api',
    name: 'DeepSeek',
    descriptionKey: 'settings.providers.desc.deepseek',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'google',
    kind: 'cloud-api',
    name: 'Google Gemini',
    descriptionKey: 'settings.providers.desc.google',
    protocol: 'google-gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    consoleUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'moonshot',
    kind: 'cloud-api',
    name: 'Moonshot',
    descriptionKey: 'settings.providers.desc.moonshot',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: ['moonshot-v1-128k', 'moonshot-v1-32k'],
  },
  {
    id: 'kimi-coding',
    kind: 'cloud-api',
    name: 'Kimi Coding Plan',
    descriptionKey: 'settings.providers.desc.kimiCoding',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.moonshot.cn/anthropic',
    consoleUrl: 'https://platform.moonshot.cn/',
    models: ['kimi-k2'],
  },
  {
    id: 'zai-coding',
    kind: 'cloud-api',
    name: 'Z.AI Coding Plan',
    descriptionKey: 'settings.providers.desc.zaiCoding',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    consoleUrl: 'https://open.bigmodel.cn/',
    models: ['glm-4.6'],
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
  // ── Local CLI ────────────────────────────────────────────────────────────
  {
    id: 'claude-code',
    kind: 'local-cli',
    name: 'Claude Code',
    descriptionKey: 'settings.providers.desc.claudeCode',
    acp: {
      via: 'adapter',
      package: '@agentclientprotocol/claude-agent-acp',
      bin: 'claude-agent-acp',
    },
    install: '@agentclientprotocol/claude-agent-acp',
  },
  {
    id: 'codex-cli',
    kind: 'local-cli',
    name: 'Codex CLI',
    descriptionKey: 'settings.providers.desc.codexCli',
    acp: { via: 'adapter', package: '@agentclientprotocol/codex-acp', bin: 'codex-acp' },
    install: '@agentclientprotocol/codex-acp',
  },
  {
    id: 'gemini-cli',
    kind: 'local-cli',
    name: 'Gemini CLI',
    descriptionKey: 'settings.providers.desc.geminiCli',
    acp: { via: 'binary', command: 'gemini', args: ['--acp'] },
    install: '@google/gemini-cli',
  },
] as const;

export function getProviderManifest(id: string): ProviderManifest | undefined {
  return PROVIDER_MANIFEST.find((p) => p.id === id);
}
