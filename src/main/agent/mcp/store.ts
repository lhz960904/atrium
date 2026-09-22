import { randomUUID } from 'node:crypto';
import type { Db } from '@main/db';
import { mcpServers } from '@main/db/schema';
import { decryptJson, encryptJson } from '@main/platform/safe-storage';
import { createLogger } from '@main/utils/log';
import { eq } from 'drizzle-orm';
import {
  type McpSecrets,
  type McpTransport,
  parseConfig,
  type ResolvedMcpServer,
  resolveMcpServer,
} from './config';
import { type ExportServer, parseMcpJson, planSync, serializeMcpServers } from './json-config';
import { type McpServerStatus, mcpManager } from './manager';
import type { McpOAuthState, McpOAuthStore } from './oauth';
import { decryptSecrets, encryptSecrets } from './secrets';

const log = createLogger('mcp');

/**
 * The configured MCP servers, and every rule about them.
 *
 * One module owns the table: what a valid config is, what a name may collide
 * with, which servers the user may not edit, when a secret is encrypted, and
 * when the live manager is told to reconnect. Those rules used to live inside a
 * tRPC router, where the only way to reach them was to send a request — and
 * where a second caller would have had to restate them.
 */

/** A name the user already gave to another server. */
export class McpNameTaken extends Error {}

/** A config the transport cannot accept. */
export class InvalidMcpConfig extends Error {}

/** A server a feature provisioned; the user may read it but not change it. */
export class ManagedMcpServer extends Error {}

/** What the settings list shows — never the encrypted blob, only whether one exists. */
export type McpServerView = {
  id: string;
  name: string;
  enabled: boolean;
  /** Provisioned by a feature (e.g. the browser); shown read-only, not editable. */
  managed: boolean;
  transport: McpTransport;
  config: Record<string, unknown> | null;
  hasCredentials: boolean;
  /** Live connection status (only meaningful while enabled); absent = not attempted. */
  status?: McpServerStatus;
};

export type McpServerInput = {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  config: Record<string, unknown>;
  secrets: McpSecrets;
};

/** Load enabled MCP servers from the DB, config-validated and with secrets merged in. */
export function loadEnabledServers(db: Db): ResolvedMcpServer[] {
  const rows = db.select().from(mcpServers).where(eq(mcpServers.enabled, true)).all();
  const servers: ResolvedMcpServer[] = [];
  for (const row of rows) {
    try {
      servers.push(resolveMcpServer(row, decryptSecrets(row.credentialsEncrypted)));
    } catch (err) {
      log.error(`skipping misconfigured MCP server "${row.name}":`, err);
    }
  }
  return servers;
}

/** Resolve a single server by id (config-validated, secrets merged), or null. */
export function resolveServerById(db: Db, id: string): ResolvedMcpServer | null {
  const row = db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  return row ? resolveMcpServer(row, decryptSecrets(row.credentialsEncrypted)) : null;
}

/** Every server as the settings list shows it, live status included. */
export function listServers(db: Db): McpServerView[] {
  const statuses = mcpManager.serverStatuses();
  return db
    .select()
    .from(mcpServers)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      managed: row.managed,
      transport: row.transport,
      config: row.config as Record<string, unknown> | null,
      hasCredentials: !!row.credentialsEncrypted,
      status: statuses[row.id],
    }));
}

/**
 * Enabled servers the user has to deal with — needs-auth or failed. Drives the
 * startup prompt and the nav badge, so a stale status for a server that was
 * deleted or switched off must never keep the badge lit.
 */
export function serversNeedingAttention(
  db: Db,
): Array<{ id: string; name: string; reason: McpServerStatus }> {
  const statuses = mcpManager.serverStatuses();
  const byId = new Map(
    db
      .select({ id: mcpServers.id, name: mcpServers.name, enabled: mcpServers.enabled })
      .from(mcpServers)
      .all()
      .map((row) => [row.id, row] as const),
  );
  return Object.entries(statuses)
    .filter(([id, status]) => status !== 'connected' && byId.get(id)?.enabled)
    .map(([id, reason]) => ({ id, name: byId.get(id)?.name ?? id, reason }));
}

export function createServer(db: Db, input: McpServerInput): string {
  assertNameFree(db, input.name);
  const config = validateConfig(input.transport, input.config);
  const id = randomUUID();
  const now = new Date();
  db.insert(mcpServers)
    .values({
      id,
      name: input.name,
      enabled: input.enabled,
      transport: input.transport,
      config,
      credentialsEncrypted: secretsBlob(input.secrets),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  sync(id);
  return id;
}

export function updateServer(db: Db, id: string, input: McpServerInput): void {
  assertNotManaged(db, id);
  assertNameFree(db, input.name, id);
  const config = validateConfig(input.transport, input.config);
  db.update(mcpServers)
    .set({
      name: input.name,
      enabled: input.enabled,
      transport: input.transport,
      config,
      credentialsEncrypted: secretsBlob(input.secrets),
      updatedAt: new Date(),
    })
    .where(eq(mcpServers.id, id))
    .run();
  sync(id);
}

export function setServerEnabled(db: Db, id: string, enabled: boolean): void {
  assertNotManaged(db, id);
  db.update(mcpServers).set({ enabled, updatedAt: new Date() }).where(eq(mcpServers.id, id)).run();
  sync(id);
}

export function removeServer(db: Db, id: string): void {
  assertNotManaged(db, id);
  db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
  void mcpManager.disconnect(id);
}

/** The decrypted secrets, so the settings form can prefill them; {} when none. */
export function serverCredentials(db: Db, id: string): McpSecrets {
  const row = db
    .select({ blob: mcpServers.credentialsEncrypted })
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .get();
  return decryptSecrets(row?.blob ?? null);
}

/** Every server as one mcp.json string; secret values stay masked by the serializer. */
export function exportServersJson(db: Db): string {
  return serializeMcpServers(userServers(db).map(toExportServer));
}

export type ApplyJsonResult = {
  created: string[];
  updated: string[];
  deleted: string[];
  warnings: string[];
};

/**
 * Apply an edited mcp.json as the full desired state: create or update by name,
 * delete whatever the JSON no longer names.
 *
 * Managed servers are left out of the sync entirely — they are not user config,
 * so the JSON neither edits nor deletes them. The manager is told to reconnect
 * only after the transaction commits, so a rolled-back write never reaches a
 * live connection.
 */
export function applyServersJson(db: Db, json: string): ApplyJsonResult {
  const parsed = parseJson(json);
  const rows = userServers(db);
  const byName = new Map(rows.map((row) => [row.name, row] as const));
  const plan = planSync(
    parsed.servers.map((server) => server.name),
    [...byName.keys()],
  );

  const now = new Date();
  const touched: string[] = [];
  const removed: string[] = [];

  db.transaction((tx) => {
    for (const server of parsed.servers) {
      const config = validateConfig(server.transport, server.config);
      const existing = byName.get(server.name);
      if (existing) {
        // The JSON shows secrets in plaintext, so what is there is what we store.
        tx.update(mcpServers)
          .set({
            name: server.name,
            enabled: server.enabled,
            transport: server.transport,
            config,
            credentialsEncrypted: secretsBlob(server.secrets),
            updatedAt: now,
          })
          .where(eq(mcpServers.id, existing.id))
          .run();
        touched.push(existing.id);
        continue;
      }
      const id = randomUUID();
      tx.insert(mcpServers)
        .values({
          id,
          name: server.name,
          enabled: server.enabled,
          transport: server.transport,
          config,
          credentialsEncrypted: secretsBlob(server.secrets),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      touched.push(id);
    }
    for (const name of plan.delete) {
      const row = byName.get(name);
      if (!row) continue;
      tx.delete(mcpServers).where(eq(mcpServers.id, row.id)).run();
      removed.push(row.id);
    }
  });

  for (const id of touched) sync(id);
  for (const id of removed) void mcpManager.disconnect(id);

  return {
    created: plan.create,
    updated: plan.update,
    deleted: plan.delete,
    warnings: parsed.warnings,
  };
}

/** Validate edited JSON, reporting the fields a parse would drop. Touches no row. */
export function previewServersJson(json: string): { warnings: string[] } {
  return { warnings: parseJson(json).warnings };
}

/** DB-backed, safeStorage-encrypted OAuth state for one server (kept out of the
 *  credentials blob so config edits don't clobber the tokens). */
export function oauthStore(db: Db, id: string): McpOAuthStore {
  return {
    load(): McpOAuthState {
      const row = db
        .select({ blob: mcpServers.oauthEncrypted })
        .from(mcpServers)
        .where(eq(mcpServers.id, id))
        .get();
      return row?.blob ? decryptJson<McpOAuthState>(row.blob) : {};
    },
    save(state: McpOAuthState): void {
      const hasAny = Boolean(state.clientInformation || state.tokens);
      db.update(mcpServers)
        .set({ oauthEncrypted: hasAny ? encryptJson(state) : null, updatedAt: new Date() })
        .where(eq(mcpServers.id, id))
        .run();
    },
  };
}

/** The servers the user configured — managed ones are not theirs to see here. */
function userServers(db: Db) {
  return db
    .select()
    .from(mcpServers)
    .all()
    .filter((row) => !row.managed);
}

const toExportServer = (row: ReturnType<typeof userServers>[number]): ExportServer => ({
  name: row.name,
  enabled: row.enabled,
  transport: row.transport,
  config: parseConfig(row.transport, row.config ?? {}),
  secrets: decryptSecrets(row.credentialsEncrypted ?? null),
});

function parseJson(json: string): ReturnType<typeof parseMcpJson> {
  try {
    return parseMcpJson(json);
  } catch (err) {
    throw new InvalidMcpConfig(err instanceof Error ? err.message : 'Invalid JSON');
  }
}

function validateConfig(transport: McpTransport, config: unknown) {
  try {
    return parseConfig(transport, config);
  } catch (err) {
    throw new InvalidMcpConfig(err instanceof Error ? err.message : 'Invalid MCP server config.');
  }
}

/** Encrypt the secret env/headers, or null when there are none to store. */
function secretsBlob(secrets: McpSecrets): Buffer | null {
  const hasAny =
    (secrets.env && Object.keys(secrets.env).length > 0) ||
    (secrets.headers && Object.keys(secrets.headers).length > 0);
  return hasAny ? encryptSecrets(secrets) : null;
}

/** Let the live manager catch up with a row that changed (reconnect, or drop it). */
function sync(id: string): void {
  void mcpManager.reload(id);
}

function assertNotManaged(db: Db, id: string): void {
  const row = db
    .select({ managed: mcpServers.managed })
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .get();
  if (row?.managed) {
    throw new ManagedMcpServer('This server is managed and cannot be changed here.');
  }
}

function assertNameFree(db: Db, name: string, excludeId?: string): void {
  const existing = db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.name, name))
    .get();
  if (existing && existing.id !== excludeId) {
    throw new McpNameTaken(`An MCP server named '${name}' already exists.`);
  }
}
