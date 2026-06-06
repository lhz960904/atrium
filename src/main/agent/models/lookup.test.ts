import { expect, test } from 'bun:test';
import {
  capabilitiesFrom,
  FALLBACK_CONTEXT_TOKENS,
  findModelInfo,
  maxContextTokensFrom,
} from './lookup';
import type { ModelsCatalog } from './types';

const catalog: ModelsCatalog = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-opus-4-5': {
        id: 'claude-opus-4-5',
        attachment: true,
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image', 'pdf'] },
        limit: { context: 200_000, output: 64_000 },
      },
    },
  },
  moonshotai: {
    id: 'moonshotai',
    models: {
      'kimi-k2': { id: 'kimi-k2', tool_call: true, limit: { context: 128_000 } },
    },
  },
  deepseek: {
    id: 'deepseek',
    models: {
      'deepseek-chat': { id: 'deepseek-chat', tool_call: true, limit: { context: 64_000 } },
    },
  },
  google: {
    id: 'google',
    models: {
      'gemini-2.5-flash-image': {
        id: 'gemini-2.5-flash-image',
        modalities: { input: ['text', 'image'], output: ['text', 'image'] },
      },
    },
  },
};

test('findModelInfo resolves a direct provider hit', () => {
  expect(findModelInfo(catalog, 'claude-opus-4-5', 'anthropic')?.id).toBe('claude-opus-4-5');
});

test('findModelInfo applies the provider alias (moonshot -> moonshotai)', () => {
  expect(findModelInfo(catalog, 'kimi-k2', 'moonshot')?.id).toBe('kimi-k2');
});

test('findModelInfo falls back to a cross-provider search when provider is unknown', () => {
  // an aggregator/local-cli provider id that is not a models.dev key
  expect(findModelInfo(catalog, 'deepseek-chat', 'openrouter')?.id).toBe('deepseek-chat');
  expect(findModelInfo(catalog, 'deepseek-chat')?.id).toBe('deepseek-chat');
});

test('findModelInfo returns undefined for a truly unknown id', () => {
  expect(findModelInfo(catalog, 'no-such-model')).toBeUndefined();
});

test('maxContextTokensFrom reads limit.context, falls back when unknown', () => {
  expect(maxContextTokensFrom(catalog, 'claude-opus-4-5', 'anthropic')).toBe(200_000);
  expect(maxContextTokensFrom(catalog, 'no-such-model')).toBe(FALLBACK_CONTEXT_TOKENS);
});

test('capabilitiesFrom flattens vision/tool/reasoning + limits', () => {
  const caps = capabilitiesFrom(catalog, 'claude-opus-4-5', 'anthropic');
  expect(caps).toEqual({
    contextTokens: 200_000,
    outputTokens: 64_000,
    vision: true,
    toolCall: true,
    reasoning: true,
    inputModalities: ['text', 'image', 'pdf'],
    outputModalities: [],
  });
});

test('capabilitiesFrom surfaces output image modality for image-gen models', () => {
  const caps = capabilitiesFrom(catalog, 'gemini-2.5-flash-image', 'google');
  expect(caps.outputModalities).toEqual(['text', 'image']);
});

test('capabilitiesFrom defaults conservatively for an unknown id', () => {
  const caps = capabilitiesFrom(catalog, 'no-such-model');
  expect(caps.vision).toBe(false);
  expect(caps.toolCall).toBe(false);
  expect(caps.reasoning).toBe(false);
  expect(caps.contextTokens).toBeUndefined();
  expect(caps.inputModalities).toEqual([]);
});
