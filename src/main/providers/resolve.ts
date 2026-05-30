import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { providers } from '../db/schema';
import { decryptCredentials } from './credentials';
import { getProviderManifest } from './manifest';

/**
 * Resolve a (providerId, modelId) pair into a ready-to-use AI SDK model,
 * pulling the decrypted key + base URL from the DB in a single read. Throws
 * with a clear message when the provider is unknown / non-cloud / missing a key.
 */
export function resolveModel(db: Db, providerId: string, modelId: string): LanguageModel {
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

  switch (manifest.protocol) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelId);
    case 'openai-compatible':
      return createOpenAICompatible({ name: providerId, apiKey, baseURL })(modelId);
    case 'google-gemini':
      return createGoogleGenerativeAI({ apiKey, baseURL })(modelId);
  }
}
