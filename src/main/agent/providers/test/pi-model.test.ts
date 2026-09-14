import { afterEach, expect, test } from 'bun:test';
import type { Db } from '@main/db';
import type { CustomModel, CustomProvider } from '@shared/custom-model';
import { piModels, refreshProviders, resolvePiModel } from '../pi-model';

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

// The registry reads every row, while a resolve reads one row's config; the
// fake answers the second from `own` since it can't see the id being asked for.
const dbWith = (rows: Row[], own: Record<string, unknown> | null = null): Db =>
  ({
    select: () => ({
      from: () => ({
        all: () => rows,
        where: () => ({ get: () => (own ? { config: own } : undefined) }),
      }),
    }),
  }) as unknown as Db;

const relay = (config: Record<string, unknown> = {}): Row => ({
  id: 'relay',
  config: { customProvider: definition, customModels: [model], ...config },
});

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

test('a defined provider’s model resolves with the provider’s format and endpoint', () => {
  refreshProviders(dbWith([relay()]));
  expect(resolvePiModel(dbWith([]), 'relay', 'relay-chat')).toMatchObject({
    id: 'relay-chat',
    provider: 'relay',
    api: 'anthropic-messages',
    baseUrl: definition.baseUrl,
    contextWindow: 200_000,
  });
});

test('a defined provider cannot shadow a built-in one', () => {
  refreshProviders(dbWith([{ ...relay(), id: 'deepseek' }]));
  expect(piModels.getProvider('deepseek')?.name).not.toBe('Relay');
  expect(piModels.getModel('deepseek', 'relay-chat')).toBeUndefined();
});

test('a removed provider leaves the registry', () => {
  refreshProviders(dbWith([relay()]));
  expect(piModels.getProvider('relay')).toBeDefined();
  refreshProviders(dbWith([]));
  expect(piModels.getProvider('relay')).toBeUndefined();
});

test('models stored on a built-in provider are not registered', () => {
  refreshProviders(dbWith([{ id: 'deepseek', config: { customModels: [model] } }]));
  expect(() => resolvePiModel(dbWith([]), 'deepseek', 'relay-chat')).toThrow('not registered');
});

test('an unknown provider or model throws instead of falling back', () => {
  expect(() => resolvePiModel(dbWith([]), 'nowhere', 'anything')).toThrow('unknown');
  expect(() => resolvePiModel(dbWith([]), 'deepseek', 'no-such-model')).toThrow('not registered');
});

test('a configured endpoint overrides the catalog one', () => {
  const [first] = piModels.getModels('deepseek');
  const resolved = resolvePiModel(
    dbWith([], { baseUrl: ' https://proxy.example.test ' }),
    'deepseek',
    first.id,
  );
  expect(resolved.baseUrl).toBe('https://proxy.example.test');
});
