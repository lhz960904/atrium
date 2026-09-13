import {
  fetchOllamaModels,
  type LocalServiceStatus,
  type ModelProbe,
  pingOllama,
  probeOllamaRegistryCached,
} from '@main/agent/providers/local-service';
import {
  getProviderManifest,
  PROVIDER_MANIFEST,
  type ProviderManifest,
} from '@main/agent/providers/manifest';
import {
  answerLogin,
  cancelLogin,
  logout,
  readLogin,
  startLogin,
} from '@main/agent/providers/oauth-login';
import { piModels, refreshProviders } from '@main/agent/providers/pi-model';
import { type PullState, pullManager } from '@main/agent/providers/pull-manager';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { decryptJson, encryptJson } from '@main/platform/safe-storage';
import {
  customModelSchema,
  customProviderIdSchema,
  customProviderSchema,
} from '@shared/custom-model';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { shell } from 'electron';
import { z } from 'zod';
import { badRequest, internalError } from '../errors';
import { publicProcedure, router } from '../trpc';

/** A user-friendly view of a provider that merges manifest + DB row. */
type ProviderView = ProviderManifest & {
  enabled: boolean;
  config: Record<string, unknown> | null;
  hasCredentials: boolean;
  /** The catalog the engine resolves for this provider — the only source. */
  models?: readonly { id: string }[];
  /** Defined by the user, so it can be edited and deleted. */
  custom?: boolean;
};

const configSchema = z.record(z.string(), z.unknown());

/** Upsert a provider's whole config blob; the row may not exist yet. */
function writeConfig(db: Db, id: string, config: Record<string, unknown>): void {
  db.insert(providers)
    .values({ id, config })
    .onConflictDoUpdate({ target: providers.id, set: { config, updatedAt: new Date() } })
    .run();
}

/** The models this provider has stored, as untyped rows — callers filter. */
function storedModels(db: Db, id: string): { config: Record<string, unknown>; models: unknown[] } {
  const row = db
    .select({ config: providers.config })
    .from(providers)
    .where(eq(providers.id, id))
    .get();
  const config = (row?.config as Record<string, unknown> | null) ?? {};
  return { config, models: Array.isArray(config.customModels) ? config.customModels : [] };
}

export const providersRouter = router({
  /**
   * Manifest ⋈ DB config, in manifest declaration order. Never includes the
   * raw encrypted credentials blob — callers ask for plaintext explicitly
   * via `getCredentials` when (and only when) they need to display it.
   */
  list: publicProcedure.query(({ ctx }): ProviderView[] => {
    const rows = ctx.db.select().from(providers).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    // A provider the user defined has no manifest entry, so one is made for it
    // from what they gave: the panel treats both the same from here on.
    const defined: ProviderView[] = rows.flatMap((row) => {
      const parsed = customProviderSchema.safeParse(
        (row.config as { customProvider?: unknown } | null)?.customProvider,
      );
      if (!parsed.success || getProviderManifest(row.id)) return [];
      return [
        {
          id: row.id,
          kind: 'cloud-api' as const,
          name: parsed.data.name,
          descriptionKey: 'settings.providers.desc.custom',
          protocol: 'openai-compatible' as const,
          defaultBaseUrl: parsed.data.baseUrl,
          consoleUrl: '',
          enabled: row.enabled,
          config: (row.config as Record<string, unknown> | null) ?? null,
          hasCredentials: !!row.credentialsEncrypted,
          models: piModels.getModels(row.id).map((model) => ({ id: model.id })),
          custom: true,
        },
      ];
    });
    const shipped: ProviderView[] = PROVIDER_MANIFEST.map((m) => {
      const row = byId.get(m.id);
      // The endpoint comes from the registry, not the manifest: the manifest
      // declares it, but what the engine resolved is what a request will use,
      // and a copy read separately is a copy that can be wrong.
      const registered = piModels.getProvider(m.id);
      return {
        ...m,
        ...(registered?.baseUrl ? { defaultBaseUrl: registered.baseUrl } : {}),
        ...(m.kind === 'cloud-api' || m.kind === 'subscription'
          ? { models: piModels.getModels(m.id).map((model) => ({ id: model.id })) }
          : {}),
        enabled: row?.enabled ?? false,
        config: (row?.config as Record<string, unknown> | null) ?? null,
        hasCredentials: !!row?.credentialsEncrypted,
      };
    });
    return [...shipped, ...defined];
  }),

  /** Define a provider Atrium doesn't ship: an endpoint, a request format, and
   *  whatever models the user adds to it. */
  createCustomProvider: publicProcedure
    .input(z.object({ id: customProviderIdSchema, provider: customProviderSchema }))
    .mutation(({ ctx, input }) => {
      if (getProviderManifest(input.id)) {
        throw badRequest(`"${input.id}" is already the id of a built-in provider.`);
      }
      const taken = ctx.db
        .select({ id: providers.id })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      if (taken) throw badRequest(`"${input.id}" is already in use.`);
      writeConfig(ctx.db, input.id, { customProvider: input.provider });
      refreshProviders(ctx.db);
    }),

  updateCustomProvider: publicProcedure
    .input(z.object({ id: z.string(), provider: customProviderSchema }))
    .mutation(({ ctx, input }) => {
      const { config } = storedModels(ctx.db, input.id);
      if (!config.customProvider) throw badRequest('Not a provider you defined.');
      writeConfig(ctx.db, input.id, { ...config, customProvider: input.provider });
      refreshProviders(ctx.db);
    }),

  /** Removes the row outright, so the stored credential goes with it. */
  deleteCustomProvider: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const { config } = storedModels(ctx.db, input.id);
      if (!config.customProvider) throw badRequest('Not a provider you defined.');
      ctx.db.delete(providers).where(eq(providers.id, input.id)).run();
      refreshProviders(ctx.db);
    }),

  /**
   * Subscription login. `start` kicks the flow off and opens the browser; the
   * panel then polls `loginState` until it lands, answering `submitLogin` on
   * the rare path where the vendor wants a pasted code.
   */
  startLogin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db
      .insert(providers)
      .values({ id: input.id, enabled: true })
      .onConflictDoUpdate({ target: providers.id, set: { enabled: true } })
      .run();
    return startLogin(input.id, (url) => void shell.openExternal(url));
  }),

  loginState: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => readLogin(input.id)),

  submitLogin: publicProcedure
    .input(z.object({ id: z.string(), value: z.string() }))
    .mutation(({ input }) => ({ ok: answerLogin(input.id, input.value) })),

  cancelLogin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    cancelLogin(input.id);
  }),

  signOut: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await logout(input.id);
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
      writeConfig(ctx.db, input.id, {
        ...((existing?.config as Record<string, unknown> | null) ?? {}),
        ...input.partial,
      });
    }),

  /**
   * Persist credentials encrypted via Electron safeStorage. The plaintext
   * is the raw key (or a JSON object for richer payloads in the future);
   * we wrap it in JSON so the same code path supports both shapes.
   */
  setCredentials: publicProcedure
    .input(z.object({ id: z.string(), plaintext: z.string() }))
    .mutation(({ ctx, input }) => {
      const blob = encryptJson({ key: input.plaintext });
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
        return decryptJson<{ key: string }>(row.blob).key;
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
        throw badRequest('Unknown local service id.');
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
        throw badRequest('Unknown local service id.');
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
        throw badRequest('Unknown local service id.');
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
        throw badRequest('Unknown local service id.');
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
  /**
   * Add or replace a model on a provider. Stored on the provider's config and
   * folded into its catalog, replacing a catalog entry of the same id — which
   * is how a wrong window gets corrected, not just how a missing model is
   * added. `previousId` lets the editor rename one without leaving the old
   * entry behind.
   */
  upsertCustomModel: publicProcedure
    .input(
      z.object({
        id: z.string(),
        model: customModelSchema,
        previousId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { config, models } = storedModels(ctx.db, input.id);
      const dropped = new Set([input.model.id, input.previousId].filter(Boolean));
      const kept = models.filter((m) => !dropped.has(String((m as { id?: unknown }).id)));
      writeConfig(ctx.db, input.id, { ...config, customModels: [...kept, input.model] });
      refreshProviders(ctx.db);
    }),

  removeCustomModel: publicProcedure
    .input(z.object({ id: z.string(), modelId: z.string() }))
    .mutation(({ ctx, input }) => {
      const { config, models } = storedModels(ctx.db, input.id);
      writeConfig(ctx.db, input.id, {
        ...config,
        customModels: models.filter((m) => String((m as { id?: unknown }).id) !== input.modelId),
      });
      refreshProviders(ctx.db);
    }),

  /** Ollama's installed list — what this machine has pulled, not what an
   *  endpoint claims to serve. Cloud providers answer from their catalog. */
  fetchModels: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<string[]> => {
      const manifest = PROVIDER_MANIFEST.find((p) => p.id === input.id);
      if (manifest?.kind !== 'local-service') {
        throw badRequest('Provider has no model listing.');
      }
      const row = ctx.db
        .select({ config: providers.config })
        .from(providers)
        .where(eq(providers.id, input.id))
        .get();
      const config = (row?.config as Record<string, unknown> | null) ?? {};
      const baseUrl =
        (typeof config.baseUrl === 'string' && config.baseUrl.trim()) || manifest.defaultBaseUrl;

      let modelIds: string[];
      try {
        modelIds = await fetchOllamaModels(baseUrl);
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw internalError(err instanceof Error ? err.message : 'Fetch failed.');
      }
      writeConfig(ctx.db, input.id, { ...config, fetchedModels: modelIds });
      return modelIds;
    }),
});
