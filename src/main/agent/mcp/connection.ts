import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../../log';
import type { ResolvedMcpServer } from './config';

const log = createLogger('mcp');
const CLIENT_INFO = { name: 'atrium', version: '0.0.0' };
const CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/** Wraps a single MCP server: its Client, transport, and last-known tool list. */
export class McpConnection {
  private client: Client | null = null;
  private tools: Tool[] = [];

  constructor(readonly server: ResolvedMcpServer) {}

  get id(): string {
    return this.server.id;
  }
  get name(): string {
    return this.server.name;
  }
  get isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    this.client = await openClient(this.server);
    await this.refreshTools();
  }

  async refreshTools(): Promise<Tool[]> {
    this.tools = (await this.requireClient().listTools()).tools;
    return this.tools;
  }

  listTools(): Tool[] {
    return this.tools;
  }

  callTool(
    rawName: string,
    args: Record<string, unknown>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CallToolResult> {
    // Use the typed request() rather than callTool(): the latter's return is a
    // fixed CallToolResult | CompatibilityCallToolResult union (the legacy arm
    // carries `toolResult`, not `content`), regardless of the schema passed.
    return this.requireClient().request(
      { method: 'tools/call', params: { name: rawName, arguments: args } },
      CallToolResultSchema,
      { signal: opts.signal, timeout: opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS },
    );
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.tools = [];
    await client?.close();
  }

  private requireClient(): Client {
    if (!this.client) throw new Error(`MCP server "${this.name}" is not connected`);
    return this.client;
  }
}

/**
 * Open a connected Client for a server, picking the transport. For `http` we use
 * Streamable HTTP and fall back to SSE for servers that only speak the legacy
 * transport. OAuth isn't wired yet — auth is via bearer/header (see httpHeaders).
 */
async function openClient(server: ResolvedMcpServer): Promise<Client> {
  if (server.transport === 'stdio') {
    return dial(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: stdioEnv(server),
        cwd: server.cwd,
      }),
    );
  }

  const url = new URL(server.url);
  const requestInit: RequestInit = { headers: httpHeaders(server) };
  if (server.transport === 'sse') {
    return dial(new SSEClientTransport(url, { requestInit }));
  }
  try {
    return await dial(new StreamableHTTPClientTransport(url, { requestInit }));
  } catch (err) {
    log.info(`"${server.name}": Streamable HTTP failed, falling back to SSE`, err);
    return dial(new SSEClientTransport(url, { requestInit }));
  }
}

async function dial(
  transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport,
): Promise<Client> {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  return client;
}

/*
 * Final HTTP headers: a Bearer from the named host env var (lowest precedence),
 * then headers whose values come from named host env vars, then the server's
 * explicit headers (static config + decrypted secrets), which win on conflict.
 */
function httpHeaders(
  server: Extract<ResolvedMcpServer, { transport: 'http' | 'sse' }>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (server.bearerTokenEnvVar) {
    const token = process.env[server.bearerTokenEnvVar];
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  for (const [name, varName] of Object.entries(server.headersFromEnv)) {
    const value = process.env[varName];
    if (value !== undefined) headers[name] = value;
  }
  return { ...headers, ...server.headers };
}

/*
 * Given no env, the SDK's stdio transport inherits only a small safe whitelist
 * (getDefaultEnvironment), not the full process env. Layer that whitelist with
 * the user's passthrough names (read from this process now) and their explicit
 * env, so the server gets PATH etc. plus exactly what was opted into.
 */
function stdioEnv(
  server: Extract<ResolvedMcpServer, { transport: 'stdio' }>,
): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const name of server.envPassthrough) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...server.env };
}
