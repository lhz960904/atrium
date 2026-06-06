/**
 * The slice of litellm's model_prices_and_context_window.json we consume. The
 * file carries far more per entry (tiered costs, regions, endpoints, …); we type
 * only what we read so upstream additions can't break parsing. It is a flat map
 * keyed by model id, plus one `sample_spec` sentinel documenting the schema.
 * Source: github.com/BerriAI/litellm (MIT).
 */

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'pdf';

export type ModelInfo = {
  litellm_provider?: string;
  /** chat | image_generation | image_edit | embedding | audio_speech | … */
  mode?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  /** Legacy: output tokens if the provider specifies it, else input tokens. */
  max_tokens?: number;
  supported_modalities?: string[];
  supported_output_modalities?: string[];
  supports_vision?: boolean;
  supports_function_calling?: boolean;
  supports_reasoning?: boolean;
  supports_pdf_input?: boolean;
};

/** litellm's file shape: a flat map keyed by model id. */
export type ModelsCatalog = Record<string, ModelInfo>;

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
