import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { SelectedModel } from '@shared/settings';
import type { ImageModel, LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import { isImageModel, modelCapabilities } from '../agent/models/catalog';
import type { Db } from '../db';
import { providers } from '../db/schema';
import { decryptCredentials } from './credentials';
import {
  anthropicApiBase,
  getProviderManifest,
  type LocalServiceManifest,
  type ProviderManifest,
} from './manifest';

type CloudManifest = Extract<ProviderManifest, { kind: 'cloud-api' }>;
type ProviderConn = { manifest: CloudManifest; apiKey: string; baseURL: string };

/**
 * A local model service (Ollama) speaks openai-compatible on /v1 with no API
 * key, so it resolves outside the keyed providerConn path. The base URL is the
 * user's override or the manifest default.
 */
function localServiceModel(db: Db, manifest: LocalServiceManifest, modelId: string) {
  const row = db
    .select({ config: providers.config })
    .from(providers)
    .where(eq(providers.id, manifest.id))
    .get();
  const base = (
    (row?.config as { baseUrl?: string } | null)?.baseUrl?.trim() || manifest.defaultBaseUrl
  ).replace(/\/+$/, '');
  return createOpenAICompatible({ name: manifest.id, baseURL: `${base}/v1` })(modelId);
}

/**
 * Read a cloud provider's decrypted key + effective base URL in a single DB
 * hit. Shared by the chat and image resolvers. Throws with a clear message when
 * the provider is unknown / non-cloud / missing a key.
 */
function providerConn(db: Db, providerId: string): ProviderConn {
  const manifest = getProviderManifest(providerId);
  if (!manifest || manifest.kind !== 'cloud-api') {
    throw new Error(`Provider "${providerId}" is not a configured cloud provider.`);
  }

  const row = db
    .select({ blob: providers.credentialsEncrypted, config: providers.config })
    .from(providers)
    .where(eq(providers.id, providerId))
    .get();
  if (!row?.blob) throw new Error(`Provider "${providerId}" has no API key configured.`);

  const apiKey = decryptCredentials<{ key: string }>(row.blob).key;
  const baseURL =
    (row.config as { baseUrl?: string } | null)?.baseUrl?.trim() || manifest.defaultBaseUrl;
  return { manifest, apiKey, baseURL };
}

/** Resolve a (providerId, modelId) pair into a ready-to-use AI SDK chat model. */
export function resolveModel(db: Db, providerId: string, modelId: string): LanguageModel {
  const known = getProviderManifest(providerId);
  if (known?.kind === 'local-service') return localServiceModel(db, known, modelId);
  const { manifest, apiKey, baseURL } = providerConn(db, providerId);
  switch (manifest.protocol) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: anthropicApiBase(baseURL) })(modelId);
    case 'openai-compatible':
      return createOpenAICompatible({ name: providerId, apiKey, baseURL })(modelId);
    case 'google-gemini':
      return createGoogleGenerativeAI({ apiKey, baseURL })(modelId);
  }
}

/**
 * Whether tool results for this provider+model may carry inline image parts.
 * Both halves matter: the model needs vision, and the provider conversion must
 * support content-type tool results with images — @ai-sdk/anthropic and
 * @ai-sdk/google do, while openai-compatible JSON-stringifies content parts,
 * which would dump raw base64 into the prompt as text.
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
 * The openai-compatible image model hardcodes `response_format: "b64_json"` in
 * the request body (no opt-out). OpenAI's gpt-image models reject that parameter
 * ("Unknown parameter: 'response_format'") — they always return base64 anyway —
 * so for those we wrap fetch to strip it from the outgoing body. dall-e still
 * needs it (its default is a URL the SDK can't read), so this is gpt-image only.
 */
type OpenAICompatibleFetch = NonNullable<Parameters<typeof createOpenAICompatible>[0]['fetch']>;

function stripResponseFormatFetch(): OpenAICompatibleFetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if ('response_format' in body) {
          delete body.response_format;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // not JSON — pass through untouched
      }
    }
    return globalThis.fetch(input, init);
  };
  // The option's type is the full `fetch` (Node's carries `preconnect`); our
  // wrapper is call-compatible, so assert across the Node/DOM lib mismatch.
  return wrapped as OpenAICompatibleFetch;
}

/**
 * Resolve a (providerId, modelId) pair into an AI SDK image model for
 * generateImage. Anthropic has no image endpoint, so it throws rather than
 * silently falling back.
 */
export function resolveImageModel(db: Db, providerId: string, modelId: string): ImageModel {
  if (getProviderManifest(providerId)?.kind === 'local-service') {
    throw new Error(`Provider "${providerId}" does not support image generation.`);
  }
  const { manifest, apiKey, baseURL } = providerConn(db, providerId);
  switch (manifest.protocol) {
    case 'openai-compatible': {
      const fetch = modelId.includes('gpt-image') ? stripResponseFormatFetch() : undefined;
      return createOpenAICompatible({ name: providerId, apiKey, baseURL, fetch }).imageModel(
        modelId,
      );
    }
    case 'google-gemini':
      return createGoogleGenerativeAI({ apiKey, baseURL }).image(modelId);
    case 'anthropic':
      throw new Error(`Provider "${providerId}" does not support image generation.`);
  }
}

/**
 * A sensible fallback chat model when nothing is explicitly selected: the first
 * enabled provider's first enabled non-image model, in provider order. Lets
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
      if (!isImageModel(modelId)) return { providerId: row.id, modelId };
    }
  }
  return null;
}
