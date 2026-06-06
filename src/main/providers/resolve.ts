import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ImageModel, LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { providers } from '../db/schema';
import { decryptCredentials } from './credentials';
import { getProviderManifest, type ProviderManifest } from './manifest';

type CloudManifest = Extract<ProviderManifest, { kind: 'cloud-api' }>;
type ProviderConn = { manifest: CloudManifest; apiKey: string; baseURL: string };

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
  const { manifest, apiKey, baseURL } = providerConn(db, providerId);
  switch (manifest.protocol) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelId);
    case 'openai-compatible':
      return createOpenAICompatible({ name: providerId, apiKey, baseURL })(modelId);
    case 'google-gemini':
      return createGoogleGenerativeAI({ apiKey, baseURL })(modelId);
  }
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
