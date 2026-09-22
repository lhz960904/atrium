import type { CredentialStore } from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { type CustomModel, type CustomProvider, customProviderSchema } from '@shared/custom-model';
import { eq } from 'drizzle-orm';
import { getProviderManifest, PROVIDER_MANIFEST, type ProviderManifest } from './manifest';
import { piModels, refreshProviders } from './registry';

/**
 * The providers the user added, and every rule about them.
 *
 * A provider is three things at once: a manifest entry Atrium ships (or one the
 * user wrote), a row saying it was added, and a credential in the store the
 * engine resolves through. Joining those is this module's job, and so is saying
 * which ids may be claimed, what "added" implies, and which providers have a
 * model list of their own at all. Those rules used to live in a tRPC router,
 * where only a request could reach them.
 */

/** An id already claimed — by a provider Atrium ships, or by one already added. */
export class ProviderIdTaken extends Error {}

/** Asked of a built-in provider something only a user-defined one has. */
export class NotADefinedProvider extends Error {}

/** A provider as the settings panel shows it: manifest ⋈ row ⋈ credential. */
export type ProviderView = ProviderManifest & {
  enabled: boolean;
  config: Record<string, unknown> | null;
  hasCredentials: boolean;
  /** The catalog the engine resolves for this provider — the only source. */
  models?: readonly { id: string }[];
  /** Defined by the user, so it can be edited and deleted. */
  custom?: boolean;
  /** The endpoint the engine resolved — the only source, and what the panel
   *  shows as the default. */
  defaultBaseUrl?: string;
};

const modelIds = (id: string) => piModels.getModels(id).map((model) => ({ id: model.id }));

const configOf = (row: { config: unknown } | undefined): Record<string, unknown> =>
  (row?.config as Record<string, unknown> | null) ?? {};

/**
 * Every added provider, built-ins in manifest order and defined ones after.
 *
 * The raw credential never appears here — only whether one exists. A provider
 * the user defined has no manifest entry, so one is made from what they gave
 * and the panel treats both the same from there on.
 */
export async function listProviders(db: Db, credentials: CredentialStore): Promise<ProviderView[]> {
  const rows = db.select().from(providers).all();
  const keyed = new Set((await credentials.list()).map((credential) => credential.providerId));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const defined: ProviderView[] = rows.flatMap((row) => {
    const parsed = customProviderSchema.safeParse(configOf(row).customProvider);
    if (!parsed.success || getProviderManifest(row.id)) return [];
    return [
      {
        id: row.id,
        authMode: 'api-key' as const,
        name: parsed.data.name,
        defaultBaseUrl: parsed.data.baseUrl,
        consoleUrl: '',
        enabled: row.enabled,
        config: (row.config as Record<string, unknown> | null) ?? null,
        hasCredentials: keyed.has(row.id),
        models: modelIds(row.id),
        custom: true,
      },
    ];
  });

  const builtin: ProviderView[] = PROVIDER_MANIFEST.filter((entry) => byId.has(entry.id)).map(
    (entry) => {
      const row = byId.get(entry.id);
      // The endpoint comes from the registry, the only place it is written
      // down: the manifest describes a provider, not how to reach one.
      return {
        ...entry,
        defaultBaseUrl: piModels.getProvider(entry.id)?.baseUrl,
        models: modelIds(entry.id),
        enabled: row?.enabled ?? false,
        config: (row?.config as Record<string, unknown> | null) ?? null,
        hasCredentials: keyed.has(entry.id),
      };
    },
  );
  return [...builtin, ...defined];
}

/** The built-in providers not added yet — the choices in the add picker. */
export function addableProviders(
  db: Db,
): Array<Pick<ProviderManifest, 'id' | 'name' | 'authMode'>> {
  const taken = new Set(
    db
      .select({ id: providers.id })
      .from(providers)
      .all()
      .map((row) => row.id),
  );
  return PROVIDER_MANIFEST.filter((entry) => !taken.has(entry.id)).map((entry) => ({
    id: entry.id,
    name: entry.name,
    authMode: entry.authMode,
  }));
}

/**
 * Add a built-in provider. Adding is the whole step — it is on from here,
 * because a provider sitting in the list doing nothing is the state everyone
 * forgets to leave.
 */
export function addProvider(db: Db, id: string): void {
  if (!getProviderManifest(id)) throw new ProviderIdTaken(`"${id}" is not a known provider.`);
  enable(db, id, true);
}

/** Take a provider off the list, and with it the key it was holding. */
export function removeProvider(db: Db, id: string): void {
  db.delete(providers).where(eq(providers.id, id)).run();
  refreshProviders(db);
}

export function setProviderEnabled(db: Db, id: string, enabled: boolean): void {
  enable(db, id, enabled);
}

/**
 * Define a provider Atrium doesn't ship: an endpoint, a request format, and
 * whatever models the user adds to it. Defining one is adding it, so it is on —
 * the same rule as picking a built-in.
 */
export function createCustomProvider(db: Db, id: string, provider: CustomProvider): void {
  if (getProviderManifest(id)) {
    throw new ProviderIdTaken(`"${id}" is already the id of a built-in provider.`);
  }
  const taken = db.select({ id: providers.id }).from(providers).where(eq(providers.id, id)).get();
  if (taken) throw new ProviderIdTaken(`"${id}" is already in use.`);
  db.insert(providers)
    .values({ id, enabled: true, config: { customProvider: provider } })
    .run();
  refreshProviders(db);
}

export function updateCustomProvider(db: Db, id: string, provider: CustomProvider): void {
  const config = storedConfig(db, id);
  if (!config.customProvider) throw new NotADefinedProvider('Not a provider you defined.');
  writeConfig(db, id, { ...config, customProvider: provider });
  refreshProviders(db);
}

/** Shallow-merge into the row's config JSON; callers pass only what changes. */
export function mergeProviderConfig(db: Db, id: string, partial: Record<string, unknown>): void {
  writeConfig(db, id, { ...storedConfig(db, id), ...partial });
}

/**
 * Add or replace a model on a provider the user defined. `previousId` is what
 * lets the editor rename one without leaving the old entry behind.
 */
export function upsertCustomModel(
  db: Db,
  id: string,
  model: CustomModel,
  previousId?: string,
): void {
  const { config, models } = definedModels(db, id);
  const dropped = new Set([model.id, previousId].filter(Boolean));
  const kept = models.filter((entry) => !dropped.has(String((entry as { id?: unknown }).id)));
  writeConfig(db, id, { ...config, customModels: [...kept, model] });
  refreshProviders(db);
}

export function removeCustomModel(db: Db, id: string, modelId: string): void {
  const { config, models } = definedModels(db, id);
  writeConfig(db, id, {
    ...config,
    customModels: models.filter((entry) => String((entry as { id?: unknown }).id) !== modelId),
  });
  refreshProviders(db);
}

/** Make sure the row exists before a login writes tokens against it. */
export function ensureProviderRow(db: Db, id: string): void {
  enable(db, id, true);
}

function enable(db: Db, id: string, enabled: boolean): void {
  db.insert(providers)
    .values({ id, enabled })
    .onConflictDoUpdate({ target: providers.id, set: { enabled, updatedAt: new Date() } })
    .run();
}

function storedConfig(db: Db, id: string): Record<string, unknown> {
  return configOf(
    db.select({ config: providers.config }).from(providers).where(eq(providers.id, id)).get(),
  );
}

/** Upsert a provider's whole config blob; the row may not exist yet. */
function writeConfig(db: Db, id: string, config: Record<string, unknown>): void {
  db.insert(providers)
    .values({ id, config })
    .onConflictDoUpdate({ target: providers.id, set: { config, updatedAt: new Date() } })
    .run();
}

/**
 * A defined provider's stored models. A built-in provider's catalog is the
 * engine's alone, so asking to change one is refused.
 */
function definedModels(db: Db, id: string): { config: Record<string, unknown>; models: unknown[] } {
  const config = storedConfig(db, id);
  if (!customProviderSchema.safeParse(config.customProvider).success) {
    throw new NotADefinedProvider('Only a provider you defined has models to change.');
  }
  return { config, models: Array.isArray(config.customModels) ? config.customModels : [] };
}
