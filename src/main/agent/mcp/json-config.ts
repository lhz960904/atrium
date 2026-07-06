import {
  type HttpConfig,
  type McpSecrets,
  type McpTransport,
  parseConfig,
  type StdioConfig,
} from './config';

/*
 * Bidirectional bridge between the de-facto `mcp.json` format (Claude Desktop /
 * Cursor / VS Code) and Atrium's DB-backed server records. The DB stays the
 * source of truth; this module is a pure convenience layer for bulk import and
 * for editing the whole set as JSON. It does no crypto and no DB access — the
 * tRPC layer decrypts secrets before serialize() and encrypts after parse().
 */

/** A server parsed out of imported JSON, ready for create/update. */
export type ImportedServer = {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  config: StdioConfig | HttpConfig;
  /** Plaintext secrets straight from the JSON; the caller encrypts them. */
  secrets: McpSecrets;
};

/** A server to render into JSON; secrets must already be decrypted by the caller. */
export type ExportServer = {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  config: StdioConfig | HttpConfig;
  secrets: McpSecrets;
};

export type ParseResult = { servers: ImportedServer[]; warnings: string[] };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const asStringMap = (v: unknown): Record<string, string> => {
  const rec = asRecord(v);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
};

const asStringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const hasInterpolation = (values: string[]): boolean => values.some((s) => s.includes('${'));

/** Normalize the `type` field's dialect variants to Atrium's transport enum. */
function normalizeTransport(type: unknown): McpTransport | null {
  if (typeof type !== 'string') return null;
  const t = type.toLowerCase().replace(/[\s_-]/g, '');
  if (t === 'stdio') return 'stdio';
  if (t === 'sse') return 'sse';
  if (t === 'http' || t === 'streamablehttp' || t === 'httpstream') return 'http';
  return null;
}

/** Locate the server map across the known dialects: `mcpServers`, `servers`, or a bare map. */
function findServerMap(root: Record<string, unknown>): Record<string, unknown> | null {
  const mcpServers = asRecord(root.mcpServers);
  if (mcpServers) return mcpServers;
  const servers = asRecord(root.servers);
  if (servers) return servers;
  // A bare `{ "name": { command|url ... } }` map with no wrapper key.
  const looksLikeServers = Object.values(root).every((v) => {
    const r = asRecord(v);
    return r != null && ('command' in r || 'url' in r);
  });
  return Object.keys(root).length > 0 && looksLikeServers ? root : null;
}

/**
 * Parse an `mcp.json` string into Atrium server records. Lenient: a malformed
 * entry is skipped with a warning rather than failing the whole import. Throws
 * only when the top-level JSON or shape is unusable.
 */
export function parseMcpJson(text: string): ParseResult {
  let root: Record<string, unknown> | null;
  try {
    root = asRecord(JSON.parse(text));
  } catch (err) {
    throw new Error(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!root) throw new Error('Expected a JSON object at the top level.');

  const map = findServerMap(root);
  if (!map) throw new Error('No "mcpServers" or "servers" object found.');

  const servers: ImportedServer[] = [];
  const warnings: string[] = [];

  for (const [name, raw] of Object.entries(map)) {
    const spec = asRecord(raw);
    if (!spec) {
      warnings.push(`Skipped "${name}": not an object.`);
      continue;
    }

    const transport =
      normalizeTransport(spec.type) ??
      ('command' in spec ? 'stdio' : 'url' in spec ? 'http' : null);
    if (!transport) {
      warnings.push(`Skipped "${name}": no "command" or "url" to infer a transport.`);
      continue;
    }

    if (spec.auth || spec.oauth) {
      warnings.push(`"${name}": OAuth client credentials were dropped (not supported yet).`);
    }
    if (spec.envFile) warnings.push(`"${name}": "envFile" was dropped (not supported).`);

    try {
      if (transport === 'stdio') {
        const env = asStringMap(spec.env);
        const cwd = typeof spec.cwd === 'string' && spec.cwd.trim() ? spec.cwd : undefined;
        if (hasInterpolation([...Object.values(env), ...asStringList(spec.args)])) {
          warnings.push(`"${name}": contains \${...} variables — Atrium won't expand them.`);
        }
        const config = parseConfig('stdio', {
          command: spec.command,
          args: asStringList(spec.args),
          envPassthrough: asStringList(spec.envPassthrough),
          cwd,
        });
        servers.push({
          name,
          enabled: spec.enabled !== false,
          transport,
          config,
          secrets: { env },
        });
      } else {
        const headers = asStringMap(spec.headers);
        if (hasInterpolation(Object.values(headers))) {
          warnings.push(`"${name}": contains \${...} variables — Atrium won't expand them.`);
        }
        const config = parseConfig(transport, {
          url: spec.url,
          headersFromEnv: asStringMap(spec.headersFromEnv),
          bearerTokenEnvVar:
            typeof spec.bearerTokenEnvVar === 'string' ? spec.bearerTokenEnvVar : undefined,
        });
        servers.push({
          name,
          enabled: spec.enabled !== false,
          transport,
          config,
          secrets: { headers },
        });
      }
    } catch (err) {
      warnings.push(`Skipped "${name}": ${err instanceof Error ? err.message : 'invalid config'}.`);
    }
  }

  return { servers, warnings };
}

/**
 * Render Atrium servers as an `mcpServers` JSON string. Secret values are written
 * in plaintext — the JSON editor is an advanced surface, and showing real values
 * makes it what-you-see-is-what-you-apply (no placeholder round-trip to reconcile).
 */
export function serializeMcpServers(servers: ExportServer[]): string {
  const out: Record<string, unknown> = {};
  for (const s of [...servers].sort((a, b) => a.name.localeCompare(b.name))) {
    const entry: Record<string, unknown> = { type: s.transport };
    if (s.transport === 'stdio') {
      const c = s.config as StdioConfig;
      entry.command = c.command;
      if (c.args.length) entry.args = c.args;
      const env = { ...c.env, ...s.secrets.env };
      if (Object.keys(env).length) entry.env = env;
      if (c.envPassthrough.length) entry.envPassthrough = c.envPassthrough;
      if (c.cwd) entry.cwd = c.cwd;
    } else {
      const c = s.config as HttpConfig;
      entry.url = c.url;
      const headers = { ...c.headers, ...s.secrets.headers };
      if (Object.keys(headers).length) entry.headers = headers;
      if (Object.keys(c.headersFromEnv).length) entry.headersFromEnv = c.headersFromEnv;
      if (c.bearerTokenEnvVar) entry.bearerTokenEnvVar = c.bearerTokenEnvVar;
    }
    if (!s.enabled) entry.enabled = false;
    out[s.name] = entry;
  }
  return JSON.stringify({ mcpServers: out }, null, 2);
}

/** Categorize a desired set of server names against the existing ones, by name. */
export function planSync(
  incoming: string[],
  existing: string[],
): { create: string[]; update: string[]; delete: string[] } {
  const have = new Set(existing);
  const want = new Set(incoming);
  return {
    create: incoming.filter((n) => !have.has(n)),
    update: incoming.filter((n) => have.has(n)),
    delete: existing.filter((n) => !want.has(n)),
  };
}
