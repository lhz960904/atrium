import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import type { CustomModel, CustomProvider } from '@shared/custom-model';
import { readCustomProviderCatalogs } from '../custom-providers';

const definition: CustomProvider = {
  name: 'Relay',
  baseUrl: 'https://relay.example.test/v1',
  api: 'openai-completions',
};

const model: CustomModel = {
  id: 'relay-chat',
  name: 'Relay Chat',
  reasoning: false,
  input: ['text'],
  cost: { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0.28 },
  contextWindow: 131_072,
  maxTokens: 8192,
};

const dbWith = (rows: Array<{ id: string; config: unknown }>): Db =>
  ({ select: () => ({ from: () => ({ all: () => rows }) }) }) as unknown as Db;

test('reads a defined provider together with its models', () => {
  const catalogs = readCustomProviderCatalogs(
    dbWith([{ id: 'relay', config: { customProvider: definition, customModels: [model] } }]),
  );
  expect(catalogs.get('relay')).toEqual({ definition, models: [model] });
});

test('a defined provider with no models is still read', () => {
  const catalogs = readCustomProviderCatalogs(
    dbWith([{ id: 'relay', config: { customProvider: definition } }]),
  );
  expect(catalogs.get('relay')).toEqual({ definition, models: [] });
});

test('built-in rows are absent, even with models stored on them', () => {
  const catalogs = readCustomProviderCatalogs(
    dbWith([
      { id: 'openai', config: null },
      { id: 'google', config: { baseUrl: 'https://example.test' } },
      { id: 'deepseek', config: { customModels: [model] } },
    ]),
  );
  expect(catalogs.size).toBe(0);
});

test('a malformed model is dropped, the rest of the provider survives', () => {
  const catalogs = readCustomProviderCatalogs(
    dbWith([
      {
        id: 'relay',
        config: {
          customProvider: definition,
          customModels: [{ id: 'x' }, model, { ...model, contextWindow: -1 }],
        },
      },
    ]),
  );
  expect(catalogs.get('relay')?.models).toEqual([model]);
});

test('a model stored with its own request format reads without it', () => {
  const catalogs = readCustomProviderCatalogs(
    dbWith([
      {
        id: 'relay',
        config: { customProvider: definition, customModels: [{ ...model, api: 'made-up' }] },
      },
    ]),
  );
  expect(catalogs.get('relay')?.models).toEqual([model]);
});

test('a provider whose definition is unreadable is skipped', () => {
  const catalogs = readCustomProviderCatalogs(
    dbWith([
      {
        id: 'relay',
        config: { customProvider: { ...definition, api: 'made-up' }, customModels: [model] },
      },
    ]),
  );
  expect(catalogs.size).toBe(0);
});
