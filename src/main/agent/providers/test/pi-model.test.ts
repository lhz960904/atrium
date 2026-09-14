import { afterEach, expect, test } from 'bun:test';
import type { Db } from '@main/db';
import type { CustomModel, CustomProvider } from '@shared/custom-model';
import { piModels, refreshProviders } from '../pi-model';

const definition: CustomProvider = {
  name: 'Relay',
  baseUrl: 'https://relay.example.test/v1',
  api: 'anthropic-messages',
};

const model: CustomModel = {
  id: 'relay-chat',
  name: 'Relay Chat',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
  contextWindow: 200_000,
  maxTokens: 32_000,
};

type Row = { id: string; config: unknown };

const dbWith = (rows: Row[]): Db =>
  ({ select: () => ({ from: () => ({ all: () => rows }) }) }) as unknown as Db;

const relay: Row = {
  id: 'relay',
  config: { customProvider: definition, customModels: [model] },
};

afterEach(() => refreshProviders(dbWith([])));

test('built-in providers register under the engine’s own ids', () => {
  expect(piModels.getProvider('moonshotai-cn')).toBeDefined();
  expect(piModels.getProvider('zai-coding-cn')).toBeDefined();
  expect(piModels.getProvider('moonshot')).toBeUndefined();
  expect(piModels.getProvider('zai-coding')).toBeUndefined();
});

test('both Ark plans register their own catalog and endpoint', () => {
  expect(piModels.getModels('volcengine-coding')).toHaveLength(11);
  expect(piModels.getModels('volcengine-agent')).toHaveLength(12);
  expect(piModels.getModel('volcengine-agent', 'doubao-seed-2.0-mini')?.baseUrl).toBe(
    'https://ark.cn-beijing.volces.com/api/plan',
  );
  expect(piModels.getModel('volcengine-coding', 'doubao-seed-2.0-mini')).toBeUndefined();
});

test('a defined provider registers its models with its own format and endpoint', () => {
  refreshProviders(dbWith([relay]));
  expect(piModels.getModel('relay', 'relay-chat')).toMatchObject({
    provider: 'relay',
    api: 'anthropic-messages',
    baseUrl: definition.baseUrl,
    contextWindow: 200_000,
  });
});

test('a defined provider cannot shadow a built-in one', () => {
  refreshProviders(dbWith([{ ...relay, id: 'deepseek' }]));
  expect(piModels.getProvider('deepseek')?.name).not.toBe('Relay');
  expect(piModels.getModel('deepseek', 'relay-chat')).toBeUndefined();
});

test('a removed provider leaves the registry', () => {
  refreshProviders(dbWith([relay]));
  expect(piModels.getProvider('relay')).toBeDefined();
  refreshProviders(dbWith([]));
  expect(piModels.getProvider('relay')).toBeUndefined();
});

test('models stored on a built-in provider are not registered', () => {
  refreshProviders(dbWith([{ id: 'deepseek', config: { customModels: [model] } }]));
  expect(piModels.getModel('deepseek', 'relay-chat')).toBeUndefined();
});
