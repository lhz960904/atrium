import type { Api, Model } from '@earendil-works/pi-ai';
import { z } from 'zod';

/**
 * A model the user added to a provider whose catalog doesn't list it.
 *
 * Derived from the engine's own `Model` rather than described again, so an
 * added model is the same kind of record as a shipped one and needs no
 * conversion. The two omitted fields are filled in from the owning provider:
 * `provider` is its id, and `baseUrl` defaults to its endpoint, so a model
 * follows a changed endpoint instead of pinning a stale copy of it.
 */
export type CustomModel = Omit<Model<Api>, 'provider' | 'baseUrl'> & {
  baseUrl?: string;
};

/** The three request shapes Atrium can speak. Matches `PROTOCOL_API`. */
export const CUSTOM_MODEL_APIS = [
  'anthropic-messages',
  'openai-completions',
  'google-generative-ai',
] as const;

const rates = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
});

/**
 * Validates what comes back out of the provider row. Stored config is edited by
 * hand often enough — and survives downgrades — that a malformed entry has to
 * be dropped rather than reach the engine as a half-built model.
 */
export const customModelSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  api: z.enum(CUSTOM_MODEL_APIS),
  reasoning: z.boolean(),
  input: z.array(z.enum(['text', 'image'])).min(1),
  cost: rates,
  /** Total window, input and output together — the engine's own reading. */
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  baseUrl: z.string().url().optional(),
});

export const DEFAULT_CUSTOM_MODEL: Omit<CustomModel, 'id' | 'name'> = {
  api: 'openai-completions',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};
