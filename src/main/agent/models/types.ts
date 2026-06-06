/**
 * The slice of the models.dev schema Atrium consumes. The live dataset carries
 * more (open_weights, temperature, tiered cost, …); we type only what we read
 * so a schema drift upstream can't break parsing — unknown fields pass through.
 * Schema reference: https://models.dev (sst/models.dev, MIT).
 */

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'pdf';

export type ModelInfo = {
  id: string;
  name?: string;
  family?: string;
  /** Coarse vision/file-attachment flag; `modalities.input` is the fine-grained signal. */
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: { input?: Modality[]; output?: Modality[] };
  limit?: { context?: number; output?: number; input?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
};

export type ProviderInfo = {
  id: string;
  name?: string;
  models: Record<string, ModelInfo>;
};

/** Top-level api.json shape: keyed by provider id, then model id. */
export type ModelsCatalog = Record<string, ProviderInfo>;

/** Flattened capabilities Atrium asks about at call sites. */
export type ModelCapabilities = {
  contextTokens?: number;
  outputTokens?: number;
  vision: boolean;
  toolCall: boolean;
  reasoning: boolean;
  inputModalities: Modality[];
  /** `image` here marks a model that generates images — drives image_gen model selection. */
  outputModalities: Modality[];
};
