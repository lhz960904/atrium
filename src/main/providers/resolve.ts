import { modelCapabilities } from '@main/agent/models/catalog';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import type { SelectedModel } from '@shared/settings';
import { eq } from 'drizzle-orm';
import { getProviderManifest } from './manifest';

/**
 * Whether tool results for this provider+model may carry inline image parts.
 * Both halves matter: the model needs vision, and the provider conversion must
 * support content-type tool results with images — the anthropic and google
 * apis do, while openai-compatible JSON-stringifies content parts, which would
 * dump raw base64 into the prompt as text.
 */
export function supportsImageToolResults(providerId: string, modelId: string): boolean {
  const manifest = getProviderManifest(providerId);
  if (manifest?.kind !== 'cloud-api') return false;
  return (
    (manifest.protocol === 'anthropic' || manifest.protocol === 'google-gemini') &&
    modelCapabilities(modelId).vision
  );
}

/**
 * A sensible fallback chat model when nothing is explicitly selected: the first
 * enabled provider's first enabled model, in provider order. Lets
 * headless features (scheduled tasks) run even before the renderer has persisted
 * a model choice. Returns null when nothing usable is enabled.
 */
export function firstEnabledModel(db: Db): SelectedModel | null {
  const rows = db
    .select({ id: providers.id, config: providers.config })
    .from(providers)
    .where(eq(providers.enabled, true))
    .all();
  for (const row of rows) {
    const enabled = (row.config as { enabledModels?: string[] } | null)?.enabledModels ?? [];
    for (const modelId of enabled) {
      return { providerId: row.id, modelId };
    }
  }
  return null;
}
