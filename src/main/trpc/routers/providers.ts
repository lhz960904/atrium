import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { providers } from '../../db/schema';
import { decryptCredentials, encryptCredentials } from '../../providers/credentials';
import { PROVIDER_MANIFEST, type ProviderManifest } from '../../providers/manifest';
import { fetchModelIds } from '../../providers/model-fetcher';
import { publicProcedure, router } from '../trpc';

/** A user-friendly view of a provider that merges manifest + DB row. */
type ProviderView = ProviderManifest & {
  enabled: boolean;
  config: Record<string, unknown> | null;
  hasCredentials: boolean;
};

const configSchema = z.record(z.string(), z.unknown());

export const providersRouter = router({
  /**
   * Manifest ⋈ DB config, in manifest declaration order. Never includes the
   * raw encrypted credentials blob — callers ask for plaintext explicitly
   * via `getCredentials` when (and only when) they need to display it.
   */
  list: publicProcedure.query(({ ctx }): ProviderView[] => {
    const rows = ctx.db.select().from(providers).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    return PROVIDER_MANIFEST.map((m) => {
      const row = byId.get(m.id);
      return {
        ...m,
        enabled: row?.enabled ?? false,
        config: (row?.config as Record<string, unknown> | null) ?? null,
        hasCredentials: !!row?.credentialsEncrypted,
      };
    });
  }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .insert(providers)
        .values({ id: input.id, enabled: input.enabled })
        .onConflictDoUpdate({
          target: providers.id,
          set: { enabled: input.enabled, updatedAt: new Date() },
        })
        .run();
    }),

  /**
   * Shallow-merge `partial` into the row's existing `config` JSON. Callers
   * pass only the fields they want to change.
   */
  updateConfig: publicProcedure
    .input(z.object({ id: z.string(), partial: configSchema }))
    .mutation(({ ctx, input }) => {
      const existing = ctx.db
        .select({ config: providers.config })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      const merged = {
        ...((existing?.config as Record<string, unknown> | null) ?? {}),
        ...input.partial,
      };
      ctx.db
        .insert(providers)
        .values({ id: input.id, config: merged })
        .onConflictDoUpdate({
          target: providers.id,
          set: { config: merged, updatedAt: new Date() },
        })
        .run();
    }),

  /**
   * Persist credentials encrypted via Electron safeStorage. The plaintext
   * is the raw key (or a JSON object for richer payloads in the future);
   * we wrap it in JSON so the same code path supports both shapes.
   */
  setCredentials: publicProcedure
    .input(z.object({ id: z.string(), plaintext: z.string() }))
    .mutation(({ ctx, input }) => {
      const blob = encryptCredentials({ key: input.plaintext });
      ctx.db
        .insert(providers)
        .values({ id: input.id, credentialsEncrypted: blob })
        .onConflictDoUpdate({
          target: providers.id,
          set: { credentialsEncrypted: blob, updatedAt: new Date() },
        })
        .run();
    }),

  /**
   * Returns the plaintext credential (currently always the API key string)
   * so the renderer can reveal it via the eye-toggle in the password field.
   * Returns null if no credentials are stored.
   */
  getCredentials: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }): string | null => {
      const row = ctx.db
        .select({ blob: providers.credentialsEncrypted })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      if (!row?.blob) return null;
      return decryptCredentials<{ key: string }>(row.blob).key;
    }),

  clearCredentials: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(providers)
        .set({ credentialsEncrypted: null, updatedAt: new Date() })
        .where(eq(providers.id, input.id))
        .run();
    }),

  /**
   * Call the provider's `/models` endpoint with the saved credentials and
   * persist the resulting id list to `config.fetchedModels`. Doubles as a
   * connection test: any auth / network failure surfaces as a TRPCError
   * the renderer can render verbatim.
   */
  fetchModels: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<string[]> => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (!manifest || manifest.kind !== 'cloud-api') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown cloud provider id.' });
      }

      const row = ctx.db
        .select({ blob: providers.credentialsEncrypted, config: providers.config })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      if (!row?.blob) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Add an API key first.',
        });
      }
      const apiKey = decryptCredentials<{ key: string }>(row.blob).key;
      const config = (row.config as { baseUrl?: string } | null) ?? {};
      const baseUrl = config.baseUrl?.trim() || manifest.defaultBaseUrl;

      let modelIds: string[];
      try {
        modelIds = await fetchModelIds({ protocol: manifest.protocol, baseUrl, apiKey });
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Fetch failed.',
        });
      }

      const mergedConfig = { ...config, fetchedModels: modelIds };
      ctx.db
        .update(providers)
        .set({ config: mergedConfig, updatedAt: new Date() })
        .where(eq(providers.id, input.id))
        .run();

      return modelIds;
    }),
});
