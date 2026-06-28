import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type McpSecrets,
  type McpTransport,
  mcpSecretsSchema,
  parseConfig,
} from '../../agent/mcp/config';
import { type McpServerStatus, mcpManager } from '../../agent/mcp/manager';
import { decryptSecrets, encryptSecrets } from '../../agent/mcp/secrets';
import type { Db } from '../../db';
import { mcpServers } from '../../db/schema';
import { publicProcedure, router } from '../trpc';

/** Settings-list view of a server — never the encrypted blob, only whether one exists. */
type McpServerView = {
  id: string;
  name: string;
  enabled: boolean;
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
      ctx.db
        .update(mcpServers)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(mcpServers.id, input.id))
        .run();
      syncServer(input.id);
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
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
});

function validateConfig(transport: McpTransport, config: unknown) {
  try {
    return parseConfig(transport, config);
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: err instanceof Error ? err.message : 'Invalid MCP server config.',
    });
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

function assertNameFree(db: Db, name: string, excludeId?: string): void {
  const existing = db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.name, name))
    .get();
  if (existing && existing.id !== excludeId) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `An MCP server named '${name}' already exists.`,
    });
  }
}
