import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { createLogger } from '@main/utils/log';
import { type CustomModel, customModelSchema } from '@shared/custom-model';

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
