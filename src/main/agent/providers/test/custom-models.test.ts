import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import type { CustomModel } from '@shared/custom-model';
import { readAddedModels } from '../custom-models';

const valid: CustomModel = {
  id: 'deepseek-chat',
  name: 'DeepSeek Chat',
  api: 'openai-completions',
  reasoning: false,
  input: ['text'],
  cost: { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0.28 },
  contextWindow: 131_072,
  maxTokens: 8192,
};

const dbWith = (rows: Array<{ id: string; config: unknown }>): Db =>
  ({ select: () => ({ from: () => ({ all: () => rows }) }) }) as unknown as Db;

test('reads the models stored on a provider', () => {
  const added = readAddedModels(dbWith([{ id: 'deepseek', config: { customModels: [valid] } }]));
  expect(added.get('deepseek')).toEqual([valid]);
});

test('providers with nothing added are absent', () => {
  const added = readAddedModels(
    dbWith([
      { id: 'openai', config: null },
      { id: 'google', config: { baseUrl: 'https://example.test' } },
      { id: 'deepseek', config: { customModels: [] } },
    ]),
  );
  expect(added.size).toBe(0);
});

test('a malformed entry is dropped, the rest of the provider survives', () => {
  const added = readAddedModels(
    dbWith([
      {
        id: 'deepseek',
        config: { customModels: [{ id: 'x' }, valid, { ...valid, contextWindow: -1 }] },
      },
    ]),
  );
  expect(added.get('deepseek')).toEqual([valid]);
});

test('an unusable api is rejected rather than passed to the engine', () => {
  const added = readAddedModels(
    dbWith([{ id: 'deepseek', config: { customModels: [{ ...valid, api: 'made-up' }] } }]),
  );
  expect(added.size).toBe(0);
});
