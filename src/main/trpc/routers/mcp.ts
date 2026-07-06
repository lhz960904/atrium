import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import {
  type ImportSourceId,
  listImportSources,
  readImportFile,
  readImportSource,
} from '../../agent/mcp/client-imports';
import {
  type McpSecrets,
  type McpTransport,
  mcpSecretsSchema,
  parseConfig,
} from '../../agent/mcp/config';
import {
  type ExportServer,
  parseMcpJson,
  planSync,
  serializeMcpServers,
} from '../../agent/mcp/json-config';
import { type McpServerStatus, mcpManager } from '../../agent/mcp/manager';
import { decryptSecrets, encryptSecrets } from '../../agent/mcp/secrets';
import type { Db } from '../../db';
import { mcpServers } from '../../db/schema';
import { badRequest, conflict } from '../errors';
import { publicProcedure, router } from '../trpc';

/** Settings-list view of a server — never the encrypted blob, only whether one exists. */
type McpServerView = {
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

const fields = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().default(false),
  transport: z.enum(['stdio', 'http', 'sse']),
  config: z.record(z.string(), z.unknown()),
  // Secret env/headers travel with the form's Save, not a separate call.
  secrets: mcpSecretsSchema.default({}),
});

/** The edited JSON is the full desired state — applying it overwrites to match. */
const jsonInput = z.object({ json: z.string() });

export const mcpRouter = router({
  list: publicProcedure.query(({ ctx }): McpServerView[] => {
    const statuses = mcpManager.serverStatuses();
    return ctx.db
      .select()
      .from(mcpServers)
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        managed: r.managed,
        transport: r.transport,
        config: r.config as Record<string, unknown> | null,
        hasCredentials: !!r.credentialsEncrypted,
        status: statuses[r.id],
      }));
  }),

  /** Enabled servers that need the user's attention (needs-auth or failed) — for the
   *  startup prompt + nav badge. */
  attention: publicProcedure.query(
    ({ ctx }): Array<{ id: string; name: string; reason: McpServerStatus }> => {
      const statuses = mcpManager.serverStatuses();
      const byId = new Map(
        ctx.db
          .select({ id: mcpServers.id, name: mcpServers.name, enabled: mcpServers.enabled })
          .from(mcpServers)
          .all()
          .map((r) => [r.id, r] as const),
      );
      // Only flag servers that still exist and are enabled — a stale manager
      // status for a deleted/disabled server must never keep the nav badge lit.
      return Object.entries(statuses)
        .filter(([id, status]) => status !== 'connected' && byId.get(id)?.enabled)
        .map(([id, reason]) => ({ id, name: byId.get(id)?.name ?? id, reason }));
    },
  ),

  authenticate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => mcpManager.authenticate(input.id)),

  create: publicProcedure.input(fields).mutation(({ ctx, input }) => {
    assertNameFree(ctx.db, input.name);
    const config = validateConfig(input.transport, input.config);
    const id = randomUUID();
    const now = new Date();
    ctx.db
      .insert(mcpServers)
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
    syncServer(id);
    return { id };
  }),

  update: publicProcedure.input(fields.extend({ id: z.string() })).mutation(({ ctx, input }) => {
    const { id, ...rest } = input;
    assertNotManaged(ctx.db, id);
    assertNameFree(ctx.db, rest.name, id);
    const config = validateConfig(rest.transport, rest.config);
    ctx.db
      .update(mcpServers)
      .set({
        name: rest.name,
        enabled: rest.enabled,
        transport: rest.transport,
        config,
        credentialsEncrypted: secretsBlob(rest.secrets),
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, id))
      .run();
    syncServer(id);
  }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      assertNotManaged(ctx.db, input.id);
      ctx.db
        .update(mcpServers)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(mcpServers.id, input.id))
        .run();
      syncServer(input.id);
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    assertNotManaged(ctx.db, input.id);
    ctx.db.delete(mcpServers).where(eq(mcpServers.id, input.id)).run();
    void mcpManager.disconnect(input.id);
  }),

  /** Decrypt the secrets so the settings form can prefill them on edit; {} when none. */
  getCredentials: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const row = ctx.db
      .select({ blob: mcpServers.credentialsEncrypted })
      .from(mcpServers)
      .where(eq(mcpServers.id, input.id))
      .get();
    return decryptSecrets(row?.blob ?? null);
  }),

  /** Which other AI clients have an importable config on this machine, and how many servers. */
  importSources: publicProcedure.query(() => listImportSources()),

  /** Read one client's config, normalized to mcp.json text, to load into the editor. */
  readImport: publicProcedure
    .input(z.object({ source: z.enum(['cursor', 'claude-code', 'claude-desktop', 'codex']) }))
    .query(({ input }) => {
      try {
        return { json: readImportSource(input.source as ImportSourceId) };
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'Import failed.');
      }
    }),

  /** Native picker for any config file (covers project-level scopes); null if cancelled. */
  importFile: publicProcedure.mutation(async () => {
    const opts: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'MCP config', extensions: ['json', 'toml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return { json: null };
    try {
      return { json: readImportFile(res.filePaths[0]) };
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }),

  /** Serialize every server to an mcp.json string; secret values always stay masked. */
  exportJson: publicProcedure.query(({ ctx }) => ({
    json: serializeMcpServers(exportServers(ctx.db)),
  })),

  /** Validate edited JSON and surface any fields dropped on parse; no DB access. */
  previewJson: publicProcedure.input(jsonInput).query(({ input }) => {
    try {
      return {
        valid: true as const,
        error: undefined,
        warnings: parseMcpJson(input.json).warnings,
      };
    } catch (err) {
      return {
        valid: false as const,
        error: err instanceof Error ? err.message : 'Invalid JSON',
        warnings: [] as string[],
      };
    }
  }),

  /** Apply an edited mcp.json as the full desired state: create/update by name, delete the rest. */
  applyJson: publicProcedure.input(jsonInput).mutation(({ ctx, input }) => {
    let parsed: ReturnType<typeof parseMcpJson>;
    try {
      parsed = parseMcpJson(input.json);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid JSON');
    }
    // Managed servers aren't user config: keep them out of the JSON sync so it
    // neither edits nor deletes them.
    const rows = ctx.db
      .select()
      .from(mcpServers)
      .all()
      .filter((r) => !r.managed);
    const byName = new Map(rows.map((r) => [r.name, r] as const));
    const plan = planSync(
      parsed.servers.map((s) => s.name),
      [...byName.keys()],
    );
    const toRemove = plan.delete;

    const now = new Date();
    const touched: string[] = [];
    const removedIds: string[] = [];

    ctx.db.transaction((tx) => {
      for (const s of parsed.servers) {
        const config = validateConfig(s.transport, s.config);
        const existing = byName.get(s.name);
        if (existing) {
          // The JSON shows secrets in plaintext, so what's there is exactly what we store.
          tx.update(mcpServers)
            .set({
              name: s.name,
              enabled: s.enabled,
              transport: s.transport,
              config,
              credentialsEncrypted: secretsBlob(s.secrets),
              updatedAt: now,
            })
            .where(eq(mcpServers.id, existing.id))
            .run();
          touched.push(existing.id);
        } else {
          const id = randomUUID();
          tx.insert(mcpServers)
            .values({
              id,
              name: s.name,
              enabled: s.enabled,
              transport: s.transport,
              config,
              credentialsEncrypted: secretsBlob(s.secrets),
              createdAt: now,
              updatedAt: now,
            })
            .run();
          touched.push(id);
        }
      }
      for (const name of toRemove) {
        const row = byName.get(name);
        if (row) {
          tx.delete(mcpServers).where(eq(mcpServers.id, row.id)).run();
          removedIds.push(row.id);
        }
      }
    });

    // Manager reconnects/disconnects are side effects — run them after the commit.
    for (const id of touched) syncServer(id);
    for (const id of removedIds) void mcpManager.disconnect(id);

    return {
      created: plan.create,
      updated: plan.update,
      deleted: toRemove,
      warnings: parsed.warnings,
    };
  }),
});

/** Every server as an ExportServer (config defaults filled, secrets decrypted). */
function exportServers(db: Db): ExportServer[] {
  return db
    .select()
    .from(mcpServers)
    .all()
    .filter((r) => !r.managed)
    .map((r) => ({
      name: r.name,
      enabled: r.enabled,
      transport: r.transport,
      config: parseConfig(r.transport, r.config ?? {}),
      secrets: decryptSecrets(r.credentialsEncrypted ?? null),
    }));
}

function validateConfig(transport: McpTransport, config: unknown) {
  try {
    return parseConfig(transport, config);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Invalid MCP server config.');
  }
}

/** Encrypt the secret env/headers, or null when there are none to store. */
function secretsBlob(secrets: McpSecrets): Buffer | null {
  const hasAny =
    (secrets.env && Object.keys(secrets.env).length > 0) ||
    (secrets.headers && Object.keys(secrets.headers).length > 0);
  return hasAny ? encryptSecrets(secrets) : null;
}

/** Apply a row change to the live manager (reconnects, or drops it if now disabled). */
function syncServer(id: string): void {
  void mcpManager.reload(id);
}

/** Managed servers (provisioned by a feature) are read-only — block user edits. */
function assertNotManaged(db: Db, id: string): void {
  const row = db
    .select({ managed: mcpServers.managed })
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .get();
  if (row?.managed) throw badRequest('This server is managed and cannot be changed here.');
}

function assertNameFree(db: Db, name: string, excludeId?: string): void {
  const existing = db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.name, name))
    .get();
  if (existing && existing.id !== excludeId) {
    throw conflict(`An MCP server named '${name}' already exists.`);
  }
}
