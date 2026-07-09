import { expect, test } from 'bun:test';
import {
  capabilitiesFrom,
  FALLBACK_CONTEXT_TOKENS,
  findModelInfo,
  maxContextTokensFrom,
  modelPricingFrom,
} from './lookup';
import type { ModelsCatalog } from './types';

const catalog: ModelsCatalog = {
  sample_spec: { mode: 'chat' },
  'claude-opus-4-5': {
    litellm_provider: 'anthropic',
    mode: 'chat',
    max_input_tokens: 200_000,
    max_output_tokens: 64_000,
    supports_vision: true,
    supports_function_calling: true,
    supports_reasoning: true,
    supports_pdf_input: true,
  },
  'gpt-image-2': {
    litellm_provider: 'openai',
    mode: 'image_generation',
    supports_vision: true,
  },
  'gemini-2.5-flash-image': {
    litellm_provider: 'vertex_ai',
    mode: 'image_generation',
    supported_modalities: ['text', 'image'],
    supported_output_modalities: ['text', 'image'],
  },
  'openrouter/some-chat': { litellm_provider: 'openrouter', mode: 'chat', max_tokens: 64_000 },
  'moonshot/kimi-k2.5': { litellm_provider: 'moonshot', mode: 'chat', max_input_tokens: 256_000 },
};

test('findModelInfo resolves a direct id hit', () => {
  expect(findModelInfo(catalog, 'claude-opus-4-5')?.litellm_provider).toBe('anthropic');
});

test('findModelInfo strips a relay vendor prefix the caller passes', () => {
  // an aggregator handing us "openai/gpt-image-2" still resolves the bare entry
  expect(findModelInfo(catalog, 'openai/gpt-image-2')?.mode).toBe('image_generation');
});

test('findModelInfo matches a prefixed catalog key by bare name', () => {
  expect(findModelInfo(catalog, 'some-chat')?.litellm_provider).toBe('openrouter');
});

test('findModelInfo matches across diverging vendor prefix + casing', () => {
  // litellm keys Kimi as moonshot/kimi-k2.5; a relay serves moonshotai/Kimi-K2.5
  expect(findModelInfo(catalog, 'moonshotai/Kimi-K2.5')?.litellm_provider).toBe('moonshot');
  expect(findModelInfo(catalog, 'some-relay/moonshotai/Kimi-K2.5')?.litellm_provider).toBe(
    'moonshot',
  );
});

test('findModelInfo never returns the sample_spec sentinel', () => {
  expect(findModelInfo(catalog, 'sample_spec')).toBeUndefined();
});

test('findModelInfo returns undefined for a truly unknown id', () => {
  expect(findModelInfo(catalog, 'no-such-model')).toBeUndefined();
});

test('maxContextTokensFrom reads max_input_tokens, falls back when unknown', () => {
  expect(maxContextTokensFrom(catalog, 'claude-opus-4-5')).toBe(200_000);
  expect(maxContextTokensFrom(catalog, 'no-such-model')).toBe(FALLBACK_CONTEXT_TOKENS);
});

test('capabilitiesFrom flattens vision/tool/reasoning + limits + pdf modality', () => {
  const caps = capabilitiesFrom(catalog, 'claude-opus-4-5');
  expect(caps).toEqual({
    contextTokens: 200_000,
    outputTokens: 64_000,
    vision: true,
    toolCall: true,
    reasoning: true,
    inputModalities: ['pdf'],
    outputModalities: [],
  });
});

test('capabilitiesFrom marks image output from mode even without output modalities', () => {
  // gpt-image-2 carries mode=image_generation but no supported_output_modalities
  expect(capabilitiesFrom(catalog, 'gpt-image-2').outputModalities).toEqual(['image']);
  // a model that also declares them keeps text+image
  expect(capabilitiesFrom(catalog, 'gemini-2.5-flash-image').outputModalities).toEqual([
    'text',
    'image',
  ]);
});

test('manifest-declared metadata covers ark plan ids the litellm dataset misses', () => {
  expect(maxContextTokensFrom(catalog, 'ark-code-latest')).toBe(200_000);
  expect(maxContextTokensFrom(catalog, 'doubao-seed-2.0-code')).toBe(262_144);
  expect(capabilitiesFrom(catalog, 'doubao-seed-2.0-pro').vision).toBe(true);
  expect(capabilitiesFrom(catalog, 'ark-code-latest').toolCall).toBe(true);
  // vendor prefix + casing resolve through the same bare-name join
  expect(maxContextTokensFrom(catalog, 'volcengine/Doubao-Seed-2.0-Lite')).toBe(262_144);
});

test('manifest-declared fields override a litellm entry, undeclared fields survive', () => {
  const withUpstream: ModelsCatalog = {
    sample_spec: {},
    'volcengine/ark-code-latest': { max_input_tokens: 999, input_cost_per_token: 5 },
  };
  // the vendor-documented window wins over litellm's bare-name variant…
  expect(maxContextTokensFrom(withUpstream, 'ark-code-latest')).toBe(200_000);
  // …while fields the manifest doesn't declare still come from litellm
  expect(modelPricingFrom(withUpstream, 'ark-code-latest').input).toBe(5);
});

test('capabilitiesFrom defaults conservatively for an unknown id', () => {
  const caps = capabilitiesFrom(catalog, 'no-such-model');
  expect(caps.vision).toBe(false);
  expect(caps.toolCall).toBe(false);
  expect(caps.reasoning).toBe(false);
  expect(caps.contextTokens).toBeUndefined();
  expect(caps.inputModalities).toEqual([]);
  expect(caps.outputModalities).toEqual([]);
});
