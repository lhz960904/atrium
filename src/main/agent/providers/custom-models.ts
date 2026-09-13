import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { createLogger } from '@main/utils/log';
import {
  type CustomModel,
  type CustomProvider,
  customModelSchema,
  customProviderSchema,
} from '@shared/custom-model';

const log = createLogger('providers');

/**
 * The models the user added, per provider. Stored on the provider's own config
 * rather than in a table of their own: an added model has no meaning apart from
 * the provider serving it, and is deleted with it.
 *
 * A malformed entry is dropped rather than repaired. Config is hand-edited and
 * survives downgrades, and a half-built model reaching the engine would fail as
 * a confusing request error instead of a missing model.
 */
export function readAddedModels(db: Db): Map<string, CustomModel[]> {
  const out = new Map<string, CustomModel[]>();
  for (const row of db
    .select({ id: providers.id, config: providers.config })
    .from(providers)
    .all()) {
    const raw = (row.config as { customModels?: unknown } | null)?.customModels;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const models: CustomModel[] = [];
    for (const entry of raw) {
      const parsed = customModelSchema.safeParse(entry);
      if (parsed.success) models.push(parsed.data);
      else log.warn(`${row.id}: dropping an unreadable custom model`);
    }
    if (models.length > 0) out.set(row.id, models);
  }
  return out;
}

/**
 * The providers the user defined, by id. They live in the same table as the
 * shipped ones — a custom provider needs the same enabled flag, the same
 * encrypted credential and the same config — and are told apart by carrying
 * their own definition rather than matching a manifest entry.
 */
export function readCustomProviders(db: Db): Map<string, CustomProvider> {
  const out = new Map<string, CustomProvider>();
  for (const row of db
    .select({ id: providers.id, config: providers.config })
    .from(providers)
    .all()) {
    const raw = (row.config as { customProvider?: unknown } | null)?.customProvider;
    if (!raw) continue;
    const parsed = customProviderSchema.safeParse(raw);
    if (parsed.success) out.set(row.id, parsed.data);
    else log.warn(`${row.id}: dropping an unreadable custom provider`);
  }
  return out;
}
