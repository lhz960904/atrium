import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import { firstEnabledModel, resolvePiModel } from '../models';
import { piModels } from '../registry';

/** A database whose provider row, whichever is asked for, holds `config`. */
const dbWith = (config: Record<string, unknown> | null = null): Db =>
  ({
    select: () => ({
      from: () => ({ where: () => ({ get: () => (config ? { config } : undefined) }) }),
    }),
  }) as unknown as Db;

const [deepseek] = piModels.getModels('deepseek');

test('a listed model resolves to its catalog entry', () => {
  expect(resolvePiModel(dbWith(), 'deepseek', deepseek.id)).toEqual(deepseek);
});

test('an unknown provider or model is refused instead of guessed', () => {
  expect(() => resolvePiModel(dbWith(), 'nowhere', 'anything')).toThrow('unknown');
  expect(() => resolvePiModel(dbWith(), 'deepseek', 'no-such-model')).toThrow('not registered');
});

test('a configured endpoint replaces the catalog one', () => {
  const resolved = resolvePiModel(
    dbWith({ baseUrl: ' https://proxy.example.test ' }),
    'deepseek',
    deepseek.id,
  );
  expect(resolved.baseUrl).toBe('https://proxy.example.test');
});

/** A database whose enabled providers are `rows`, in order. */
const enabledProviders = (rows: Array<{ id: string; config: unknown }>): Db =>
  ({ select: () => ({ from: () => ({ where: () => ({ all: () => rows }) }) }) }) as unknown as Db;

test('a fallback skips picks the registry no longer lists', () => {
  const db = enabledProviders([
    { id: 'deepseek', config: { enabledModels: ['retired-model', deepseek.id] } },
  ]);
  expect(firstEnabledModel(db)).toEqual({ providerId: 'deepseek', modelId: deepseek.id });
});

test('a provider left with only stale picks yields to the next one', () => {
  const [codex] = piModels.getModels('openai-codex');
  const db = enabledProviders([
    { id: 'deepseek', config: { enabledModels: ['retired-model'] } },
    { id: 'openai-codex', config: null },
  ]);
  expect(firstEnabledModel(db)).toEqual({ providerId: 'openai-codex', modelId: codex.id });
});

test('nothing usable leaves no fallback', () => {
  const db = enabledProviders([
    { id: 'deepseek', config: { enabledModels: ['retired-model'] } },
    { id: 'openai-codex', config: { enabledModels: ['retired-model'] } },
  ]);
  expect(firstEnabledModel(db)).toBeNull();
});
