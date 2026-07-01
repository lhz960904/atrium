import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { providers } from '../../db/schema';
import { decryptCredentials, encryptCredentials } from '../../providers/credentials';
import {
  fetchOllamaModels,
  type LocalServiceStatus,
  type ModelProbe,
  pingOllama,
  probeOllamaRegistryCached,
} from '../../providers/local-service';
import { PROVIDER_MANIFEST, type ProviderManifest } from '../../providers/manifest';
import { fetchModelIds } from '../../providers/model-fetcher';
import { type PullState, pullManager } from '../../providers/pull-manager';
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
      try {
        return decryptCredentials<{ key: string }>(row.blob).key;
      } catch {
        // The blob can't be decrypted — the safeStorage key was removed or
        // rotated in the OS keychain, so the ciphertext is unrecoverable.
        // Report it as "no readable credential" so the field falls back to an
        // empty, editable input and the user can re-enter the key.
        return null;
      }
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
   * Liveness probe for a local model service (Ollama). Read-only and cheap, so
   * the settings UI can poll it; "not running" is a normal answer, not an error.
   */
  detectLocalService: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<LocalServiceStatus> => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (!manifest || manifest.kind !== 'local-service') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown local service id.' });
      }
      const row = ctx.db
        .select({ config: providers.config })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      const baseUrl =
        (row?.config as { baseUrl?: string } | null)?.baseUrl?.trim() || manifest.defaultBaseUrl;
      return pingOllama(baseUrl);
    }),

  /** Kick off a model download on the local service; progress is polled via
   *  pullStates (the pull runs for minutes — far beyond any request). */
  pullModel: publicProcedure
    .input(z.object({ id: z.string(), model: z.string().min(1) }))
    .mutation(({ ctx, input }): { started: boolean } => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (!manifest || manifest.kind !== 'local-service') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown local service id.' });
      }
      const row = ctx.db
        .select({ config: providers.config })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      const baseUrl =
        (row?.config as { baseUrl?: string } | null)?.baseUrl?.trim() || manifest.defaultBaseUrl;
      return { started: pullManager.start(baseUrl, input.model.trim()) };
    }),

  /** Snapshot of in-flight (and just-finished) downloads for the polling UI. */
  pullStates: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }): PullState[] => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (!manifest || manifest.kind !== 'local-service') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown local service id.' });
      }
      return pullManager.list();
    }),

  /**
   * Validate model names against the public registry and read their download
   * sizes. Backs the curated rows (live sizes instead of hardcoded ones) and
   * the validating autocomplete. A registry failure yields exists=null —
   * "couldn't verify", which never blocks a download attempt.
   */
  probeModels: publicProcedure
    .input(z.object({ id: z.string(), models: z.array(z.string().min(1)).max(20) }))
    .query(async ({ input }): Promise<Record<string, ModelProbe>> => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (!manifest || manifest.kind !== 'local-service') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown local service id.' });
      }
      const entries = await Promise.all(
        input.models.map(async (m): Promise<[string, ModelProbe]> => {
          try {
            return [m, await probeOllamaRegistryCached(m.trim())];
          } catch {
            return [m, { exists: null }];
          }
        }),
      );
      return Object.fromEntries(entries);
    }),

  /**
   * List the provider's available models and persist them to
   * `config.fetchedModels`. Cloud providers call their `/models` endpoint with
   * the saved credentials (doubling as a connection test); a local service
   * lists its installed models keylessly. Failures surface as TRPCErrors the
   * renderer renders verbatim.
   */
  fetchModels: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<string[]> => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (!manifest || manifest.kind === 'local-cli') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provider has no model listing.' });
      }

      const row = ctx.db
        .select({ blob: providers.credentialsEncrypted, config: providers.config })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      const config = (row?.config as { baseUrl?: string } | null) ?? {};
      const baseUrl = config.baseUrl?.trim() || manifest.defaultBaseUrl;

      let modelIds: string[];
      try {
        if (manifest.kind === 'local-service') {
          modelIds = await fetchOllamaModels(baseUrl);
        } else {
          if (!row?.blob) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add an API key first.' });
          }
          const apiKey = decryptCredentials<{ key: string }>(row.blob).key;
          modelIds = await fetchModelIds({ protocol: manifest.protocol, baseUrl, apiKey });
        }
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Fetch failed.',
        });
      }

      const mergedConfig = { ...config, fetchedModels: modelIds };
      ctx.db
        .insert(providers)
        .values({ id: input.id, config: mergedConfig })
        .onConflictDoUpdate({
          target: providers.id,
          set: { config: mergedConfig, updatedAt: new Date() },
        })
        .run();

      return modelIds;
    }),
});
