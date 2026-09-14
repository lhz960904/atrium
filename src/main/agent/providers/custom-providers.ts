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

/** A provider the user defined, together with the models they added to it. */
export type CustomProviderCatalog = {
  definition: CustomProvider;
  models: CustomModel[];
};

/**
 * The providers the user defined, each read with its models from its own row.
 * A malformed definition or model is dropped rather than repaired: config is
 * hand-edited, and a half-built entry would reach the engine as a confusing
 * request error instead of a missing one.
 */
export function readCustomProviderCatalogs(db: Db): Map<string, CustomProviderCatalog> {
  const out = new Map<string, CustomProviderCatalog>();
  for (const row of db
    .select({ id: providers.id, config: providers.config })
    .from(providers)
    .all()) {
    const config = (row.config as Record<string, unknown> | null) ?? {};
    if (!config.customProvider) continue;
    const definition = customProviderSchema.safeParse(config.customProvider);
    if (!definition.success) {
      log.warn(`${row.id}: dropping an unreadable custom provider`);
      continue;
    }
    const models: CustomModel[] = [];
    for (const entry of Array.isArray(config.customModels) ? config.customModels : []) {
      const parsed = customModelSchema.safeParse(entry);
      if (parsed.success) models.push(parsed.data);
      else log.warn(`${row.id}: dropping an unreadable custom model`);
    }
    out.set(row.id, { definition: definition.data, models });
  }
  return out;
}
