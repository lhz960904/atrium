import type { Api, Model } from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import type { TokenRates } from '@shared/cost';
import type { SelectedModel } from '@shared/settings';
import { eq } from 'drizzle-orm';
import { getProviderManifest } from './manifest';
import { piModels } from './pi-model';

function configuredBaseUrl(db: Db, providerId: string): string | undefined {
  const row = db
    .select({ config: providers.config })
    .from(providers)
    .where(eq(providers.id, providerId))
    .get();
  return (row?.config as { baseUrl?: string } | null)?.baseUrl?.trim() || undefined;
}

/**
 * The registry's entry for a (provider, model) pair, on the endpoint the user
 * configured if they did. A pair the registry doesn't list is refused rather
 * than run on guessed metadata, since a wrong window or price fails silently.
 * The stored endpoint is used verbatim; validating it is the settings panel's job.
 */
export function resolvePiModel(db: Db, providerId: string, modelId: string): Model<Api> {
  const provider = piModels.getProvider(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" is unknown.`);
  const model = piModels.getModel(providerId, modelId);
  if (!model) throw new Error(`Model "${modelId}" is not registered for ${provider.name}.`);
  const baseUrl = configuredBaseUrl(db, providerId);
  return baseUrl ? { ...model, baseUrl } : model;
}

/**
 * Whether tool results for this model may carry inline image parts. Both halves
 * matter: the model needs vision, and the api module must be able to send a
 * content-typed tool result — the anthropic and google apis can, while
 * openai-completions JSON-stringifies content parts, which would dump raw
 * base64 into the prompt as text. Both facts live on the model, so a provider
 * serving one model per api answers correctly per model.
 */
export function supportsImageToolResults(model: Model<Api>): boolean {
  return (
    (model.api === 'anthropic-messages' || model.api === 'google-generative-ai') &&
    model.input.includes('image')
  );
}

/** The engine prices per million tokens; the ledger and the renderer's readout
 *  both work per token. */
export function modelRates(model: Model<Api>): TokenRates {
  return {
    input: model.cost.input / 1e6,
    output: model.cost.output / 1e6,
    cacheRead: model.cost.cacheRead / 1e6,
    cacheCreation: model.cost.cacheWrite / 1e6,
  };
}

const NO_RATES: TokenRates = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/** Rates for a (provider, model) pair named only by id — for the ledger's
 *  injection points, which record a call after the fact. An unresolvable pair
 *  prices at zero rather than failing the call that is being recorded. */
export function ratesFor(db: Db, providerId: string, modelId: string): TokenRates {
  try {
    return modelRates(resolvePiModel(db, providerId, modelId));
  } catch {
    return NO_RATES;
  }
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
    const picked = (row.config as { enabledModels?: string[] } | null)?.enabledModels ?? [];
    // A pick outlives its model when a catalog changes or a custom model is
    // deleted, so only one the registry still lists counts.
    const usable = picked.find((modelId) => piModels.getModel(row.id, modelId));
    if (usable) return { providerId: row.id, modelId: usable };
    // A subscription is granted by signing in, not by picking models, so an
    // untouched one still offers its catalog.
    if (picked.length === 0 && getProviderManifest(row.id)?.kind === 'subscription') {
      const first = piModels.getModels(row.id)[0];
      if (first) return { providerId: row.id, modelId: first.id };
    }
  }
  return null;
}
