import { expect, test } from 'bun:test';
import { deriveGroups } from './use-chat-model';

const base = { config: null, models: [] } as const;

test('a disabled provider offers nothing', () => {
  expect(
    deriveGroups([
      {
        ...base,
        id: 'openai',
        name: 'OpenAI',
        kind: 'cloud-api',
        enabled: false,
        config: { enabledModels: ['gpt-5'] },
      },
    ]),
  ).toEqual([]);
});

test('a key-based provider offers only what was picked', () => {
  expect(
    deriveGroups([
      {
        ...base,
        id: 'openrouter',
        name: 'OpenRouter',
        kind: 'cloud-api',
        enabled: true,
        config: { enabledModels: ['a'] },
        models: [{ id: 'a' }, { id: 'b' }],
      },
    ]),
  ).toEqual([{ providerId: 'openrouter', providerName: 'OpenRouter', models: ['a'] }]);
});

test('a key-based provider with nothing picked offers nothing', () => {
  expect(
    deriveGroups([
      {
        ...base,
        id: 'openrouter',
        name: 'OpenRouter',
        kind: 'cloud-api',
        enabled: true,
        models: [{ id: 'a' }],
      },
    ]),
  ).toEqual([]);
});

test('signing into a subscription is enough to offer its catalog', () => {
  expect(
    deriveGroups([
      {
        ...base,
        id: 'openai-codex',
        name: 'OpenAI Codex',
        kind: 'subscription',
        enabled: true,
        models: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }],
      },
    ]),
  ).toEqual([
    {
      providerId: 'openai-codex',
      providerName: 'OpenAI Codex',
      models: ['gpt-5.4', 'gpt-5.4-mini'],
    },
  ]);
});

test('a subscription narrowed by hand keeps that choice', () => {
  expect(
    deriveGroups([
      {
        ...base,
        id: 'openai-codex',
        name: 'OpenAI Codex',
        kind: 'subscription',
        enabled: true,
        config: { enabledModels: ['gpt-5.4'] },
        models: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }],
      },
    ]),
  ).toEqual([{ providerId: 'openai-codex', providerName: 'OpenAI Codex', models: ['gpt-5.4'] }]);
});
