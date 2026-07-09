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

export type ProviderKind = 'cloud-api' | 'local-cli' | 'local-service';
export type CloudApiProtocol = 'anthropic' | 'openai-compatible' | 'google-gemini';

/**
 * @ai-sdk/anthropic requests `${baseURL}/messages`, so it needs a base that
 * already contains the `/v1` segment — but vendors advertise their
 * Anthropic-compatible bases without it (Claude Code appends `/v1/messages`
 * itself), and users paste those documented URLs. Accept both shapes by
 * appending `/v1` unless the base already ends with it.
 */
export function anthropicApiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * How to launch a local CLI as an ACP agent. Some CLIs speak ACP natively (run
 * their own binary); others need the official ACP adapter package, whose bin we
 * resolve from node_modules.
 */
export type AcpLaunch =
  | { via: 'binary'; command: string; args: readonly string[] }
  | { via: 'adapter'; package: string; bin: string };

/**
 * A model in a provider's curated catalog. `catalogId` maps the vendor's
 * serving id to the litellm catalog key that carries its metadata, for when
 * the two spellings differ (litellm pins versions: `doubao-seed-2.0-code` is
 * keyed `volcengine/doubao-seed-2-0-code-preview-260215`). The remaining
 * fields are vendor-documented facts for ids litellm doesn't carry at all;
 * anything declared overrides the litellm entry, undeclared fields still
 * resolve through it (see agent/models/lookup.ts).
 */
export type ManifestModel = {
  id: string;
  catalogId?: string;
  contextTokens?: number;
  outputTokens?: number;
  vision?: boolean;
  toolCall?: boolean;
  reasoning?: boolean;
};

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

export type LocalCliManifest = {
  id: string;
  kind: 'local-cli';
  name: string;
  descriptionKey: string;
  acp: AcpLaunch;
  /** npm package the user global-installs (we don't bundle it) — shown as a hint. */
  install: string;
};

/**
 * A model server running on the user's machine (Ollama). Speaks the
 * openai-compatible protocol on a localhost port — no API key, no spawned
 * process; Atrium just detects whether the service is up and talks HTTP.
 * Endpoint paths (health probe, model listing) live with the service's API
 * knowledge in local-service.ts, like the cloud listing paths live in
 * model-fetcher.ts — the manifest only carries what varies or is user-facing.
 */
export type LocalServiceManifest = {
  id: string;
  kind: 'local-service';
  name: string;
  descriptionKey: string;
  defaultBaseUrl: string;
};

export type ProviderManifest = CloudApiManifest | LocalCliManifest | LocalServiceManifest;

/**
 * The Ark plans serve the doubao-seed-2.0 family under bare ids while litellm
 * keys them version-pinned, so the bare-name join misses; map to the litellm
 * keys so window/capability/pricing data flows from the catalog.
 */
const DOUBAO_SEED_2 = {
  mini: { id: 'doubao-seed-2.0-mini', catalogId: 'volcengine/doubao-seed-2-0-mini-260215' },
  lite: { id: 'doubao-seed-2.0-lite', catalogId: 'volcengine/doubao-seed-2-0-lite-260215' },
  code: { id: 'doubao-seed-2.0-code', catalogId: 'volcengine/doubao-seed-2-0-code-preview-260215' },
  pro: { id: 'doubao-seed-2.0-pro', catalogId: 'volcengine/doubao-seed-2-0-pro-260215' },
} satisfies Record<string, ManifestModel>;

// Auto-dispatch alias litellm can't know; sized to the smallest window in its
// dispatch pool.
const ARK_CODE_LATEST: ManifestModel = {
  id: 'ark-code-latest',
  contextTokens: 200_000,
  outputTokens: 131_072,
  toolCall: true,
  reasoning: true,
};

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
      ARK_CODE_LATEST,
      DOUBAO_SEED_2.mini,
      DOUBAO_SEED_2.lite,
      DOUBAO_SEED_2.code,
      DOUBAO_SEED_2.pro,
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
      ARK_CODE_LATEST,
      // Retired from litellm's dataset; vendor doc: 256k window, multimodal.
      {
        id: 'doubao-seed-code',
        contextTokens: 262_144,
        vision: true,
        toolCall: true,
        reasoning: true,
      },
      DOUBAO_SEED_2.code,
      DOUBAO_SEED_2.lite,
      DOUBAO_SEED_2.pro,
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
