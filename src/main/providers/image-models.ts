import { eq } from 'drizzle-orm';
import { modelCapabilities } from '../agent/models/catalog';
import type { Db } from '../db';
import { providers } from '../db/schema';

export type ImageModelRef = { providerId: string; modelId: string };

/**
 * Enabled (provider, model) pairs whose model generates images, in provider
 * declaration order. The image_gen tool picks from this — no separate image
 * model config; whatever the user enabled in Settings that the catalog marks as
 * image-output is usable. The capability check is the catalog's output modality.
 */
export function listEnabledImageModels(db: Db): ImageModelRef[] {
  const rows = db
    .select({ id: providers.id, config: providers.config })
    .from(providers)
    .where(eq(providers.enabled, true))
    .all();

  const refs: ImageModelRef[] = [];
  for (const row of rows) {
    const enabled = (row.config as { enabledModels?: string[] } | null)?.enabledModels ?? [];
    for (const modelId of enabled) {
      if (modelCapabilities(modelId, row.id).outputModalities.includes('image')) {
        refs.push({ providerId: row.id, modelId });
      }
    }
  }
  return refs;
}
