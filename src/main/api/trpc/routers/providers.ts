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
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { decryptJson, encryptJson } from '@main/platform/safe-storage';
import {
  customModelSchema,
  customProviderIdSchema,
  customProviderSchema,
} from '@shared/custom-model';
import { eq } from 'drizzle-orm';
import { shell } from 'electron';
import { z } from 'zod';
import { badRequest } from '../errors';
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
  /** The endpoint the engine resolved for this provider — the only source, and
   *  what the settings panel shows as the default. */
  defaultBaseUrl?: string;
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
  /**
   * The providers the user has added, in manifest order. Adding one is what
   * makes it exist here — there is no separate step that turns it on, because
   * a provider sitting in the list doing nothing is the state everyone forgets
   * to leave.
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
    const shipped: ProviderView[] = PROVIDER_MANIFEST.filter((m) => byId.has(m.id)).map((m) => {
      const row = byId.get(m.id);
      // The endpoint comes from the registry, which is the only place it is
      // written down: the manifest describes a provider, it doesn't say how to
      // reach one.
      const registered = piModels.getProvider(m.id);
      return {
        ...m,
        defaultBaseUrl: registered?.baseUrl,
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

  /** The shipped providers not added yet — the choices in the add picker. */
  available: publicProcedure.query(({ ctx }) => {
    const taken = new Set(
      ctx.db
        .select({ id: providers.id })
        .from(providers)
        .all()
        .map((r) => r.id),
    );
    return PROVIDER_MANIFEST.filter((m) => !taken.has(m.id)).map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      descriptionKey: m.descriptionKey,
    }));
  }),

  /** Add a shipped provider. Adding is the whole step: it is on from here. */
  add: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    if (!getProviderManifest(input.id)) throw badRequest(`"${input.id}" is not a known provider.`);
    ctx.db
      .insert(providers)
      .values({ id: input.id, enabled: true })
      .onConflictDoUpdate({ target: providers.id, set: { enabled: true, updatedAt: new Date() } })
      .run();
  }),

  /** Remove a provider from the list, and with it the key it was holding. */
  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.delete(providers).where(eq(providers.id, input.id)).run();
    refreshProviders(ctx.db);
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
      // Defining one is adding it, so it is on — the same rule as picking a
      // shipped provider.
      ctx.db
        .insert(providers)
        .values({ id: input.id, enabled: true, config: { customProvider: input.provider } })
        .run();
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
});
