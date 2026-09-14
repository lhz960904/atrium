import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import { piModels } from '../pi-model';
import { resolvePiModel } from '../resolve';

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
