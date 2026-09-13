import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { createLogger } from '@main/utils/log';
import type { CustomProvider } from '@shared/custom-model';
import { eq } from 'drizzle-orm';
import { getProviderManifest } from './manifest';

const log = createLogger('providers');

/**
 * Providers Atrium used to ship. A row for one of these is still a working
 * configuration — an endpoint the user chose and a key they saved — so it is
 * carried over as a provider they defined rather than left pointing at nothing.
 *
 * The endpoint is only a fallback: a row that overrode it keeps its own.
 */
const RETIRED: Record<string, CustomProvider> = {
  aihubmix: { name: 'AiHubMix', baseUrl: 'https://aihubmix.com/v1', api: 'openai-completions' },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-completions',
  },
};

/**
 * Adopt the rows of retired providers, once. Runs before the registry is built
 * so a carried-over provider is registered in the same pass as any other.
 *
 * Only rows Atrium no longer ships are touched, and only those not already
 * carrying their own definition — so this is a no-op on every later start, and
 * a user who has since edited one keeps their edit.
 */
export function adoptRetiredProviders(db: Db): void {
  for (const row of db
    .select({ id: providers.id, config: providers.config })
    .from(providers)
    .all()) {
    const retired = RETIRED[row.id];
    if (!retired || getProviderManifest(row.id)) continue;
    const config = (row.config as Record<string, unknown> | null) ?? {};
    if (config.customProvider) continue;
    const baseUrl =
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim()
        : retired.baseUrl;
    db.update(providers)
      .set({
        config: { ...config, customProvider: { ...retired, baseUrl } },
        updatedAt: new Date(),
      })
      .where(eq(providers.id, row.id))
      .run();
    log.info(`carried ${row.id} over as a provider you define`);
  }
}
