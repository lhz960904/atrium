import { z } from 'zod';
import type { McpServerRow } from '../../db/schema';

/*
 * The shape of an MCP server's stored configuration. A row's non-secret config
 * lives in mcp_servers.config (JSON, per-transport shape below); secret env
 * values and headers live separately, safeStorage-encrypted, as McpSecrets. The
 * transport column picks which config schema applies. This module is pure (zod
 * only) so it stays unit-testable — the safeStorage crypto is in ./secrets.
 */

const stringMap = z.record(z.string(), z.string());

/** stdio launch config; secret env values are layered in from McpSecrets. */
export const stdioConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  // Non-secret env. Names whose values come from the host process belong in
  // envPassthrough; truly secret values belong in McpSecrets.env.
  env: stringMap.default({}),
  // Host env var names forwarded from process.env at connect time.
  envPassthrough: z.array(z.string()).default([]),
  // Working directory; empty means the thread's workspace root.
  cwd: z.string().optional(),
});

/** Streamable HTTP / SSE config; secret headers are layered in from McpSecrets. */
export const httpConfigSchema = z.object({
  url: z.url(),
  headers: stringMap.default({}),
  // Header values pulled from host env vars at connect time: header name -> env var name.
  headersFromEnv: stringMap.default({}),
  // Convenience for the common case: a host env var whose value becomes the
  // `Authorization: Bearer <value>` header at connect time.
  bearerTokenEnvVar: z.string().optional(),
});

export type StdioConfig = z.infer<typeof stdioConfigSchema>;
export type HttpConfig = z.infer<typeof httpConfigSchema>;

/** The secret half, stored safeStorage-encrypted in credentials_encrypted. */
export const mcpSecretsSchema = z.object({
  env: stringMap.optional(),
  headers: stringMap.optional(),
});
export type McpSecrets = z.infer<typeof mcpSecretsSchema>;

/**
 * A row with its config validated and its secrets merged in, ready for the
 * connection layer. Secret values win over non-secret on key conflict.
 * envPassthrough stays a list of names — it's resolved against process.env at
 * connect time, not here, so this function remains pure.
 */
export type ResolvedMcpServer = { id: string; name: string; enabled: boolean } & (
  | {
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
      envPassthrough: string[];
      cwd?: string;
    }
  | {
      transport: 'http' | 'sse';
      url: string;
      // Static config headers with decrypted-secret header values layered on top.
      headers: Record<string, string>;
      // Header name -> host env var name; resolved against process.env at connect time.
      headersFromEnv: Record<string, string>;
      // Host env var whose value becomes the Authorization: Bearer header at connect time.
      bearerTokenEnvVar?: string;
    }
);

export function resolveMcpServer(row: McpServerRow, secrets: McpSecrets): ResolvedMcpServer {
  const base = { id: row.id, name: row.name, enabled: row.enabled };
  if (row.transport === 'stdio') {
    const c = stdioConfigSchema.parse(row.config ?? {});
    return {
      ...base,
      transport: 'stdio',
      command: c.command,
      args: c.args,
      env: { ...c.env, ...secrets.env },
      envPassthrough: c.envPassthrough,
      cwd: c.cwd,
    };
  }
  const c = httpConfigSchema.parse(row.config ?? {});
  return {
    ...base,
    transport: row.transport,
    url: c.url,
    headers: { ...c.headers, ...secrets.headers },
    headersFromEnv: c.headersFromEnv,
    bearerTokenEnvVar: c.bearerTokenEnvVar,
  };
}

export type McpTransport = 'stdio' | 'http' | 'sse';

/** Validate stored config against the schema its transport selects (throws on bad). */
export function parseConfig(transport: McpTransport, config: unknown): StdioConfig | HttpConfig {
  return transport === 'stdio' ? stdioConfigSchema.parse(config) : httpConfigSchema.parse(config);
}
