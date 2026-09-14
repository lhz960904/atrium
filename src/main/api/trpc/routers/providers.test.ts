import { expect, mock, test } from 'bun:test';
import type { Db } from '@main/db';
import type { CustomModel, CustomProvider } from '@shared/custom-model';

mock.module('electron', () => ({ shell: { openExternal: () => undefined } }));
const { providersRouter } = await import('./providers');

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
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8192,
};

/** A provider row holding `config`, recording every config it is asked to write. */
function rowWith(config: Record<string, unknown>): { db: Db; writes: unknown[] } {
  const writes: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({ all: () => [], where: () => ({ get: () => ({ config }) }) }),
    }),
    insert: () => ({
      values: (value: unknown) => ({
        onConflictDoUpdate: () => ({ run: () => writes.push(value) }),
      }),
    }),
  } as unknown as Db;
  return { db, writes };
}

const caller = (db: Db) => providersRouter.createCaller({ db, chatEndpoint: {} as never });

test('a built-in provider takes no added models', async () => {
  const { db, writes } = rowWith({ enabledModels: ['deepseek-v4-flash'] });
  await expect(caller(db).upsertCustomModel({ id: 'deepseek', model })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(
    caller(db).removeCustomModel({ id: 'deepseek', modelId: 'relay-chat' }),
  ).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(writes).toHaveLength(0);
});

test('a defined provider takes, renames and removes its models', async () => {
  const added = rowWith({ customProvider: definition, customModels: [] });
  await caller(added.db).upsertCustomModel({ id: 'relay', model });
  expect(added.writes).toEqual([
    { id: 'relay', config: { customProvider: definition, customModels: [model] } },
  ]);

  const renamed = rowWith({ customProvider: definition, customModels: [model] });
  await caller(renamed.db).upsertCustomModel({
    id: 'relay',
    model: { ...model, id: 'relay-chat-2' },
    previousId: 'relay-chat',
  });
  expect(renamed.writes).toEqual([
    {
      id: 'relay',
      config: { customProvider: definition, customModels: [{ ...model, id: 'relay-chat-2' }] },
    },
  ]);

  const removed = rowWith({ customProvider: definition, customModels: [model] });
  await caller(removed.db).removeCustomModel({ id: 'relay', modelId: 'relay-chat' });
  expect(removed.writes).toEqual([
    { id: 'relay', config: { customProvider: definition, customModels: [] } },
  ]);
});
