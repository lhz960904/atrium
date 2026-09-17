import { expect, mock, test } from 'bun:test';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import type { CustomModel, CustomProvider } from '@shared/custom-model';

// Bun caches a module mock's export shape for the whole process, so a partial
// electron here removes exports the suites around this one still import.
mock.module('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { openExternal: () => undefined },
}));
const { providersRouter } = await import('../providers');

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

/** Provider rows for listing plus one row holding `config`, recording config writes. */
function rowWith(
  config: Record<string, unknown>,
  rows: unknown[] = [],
): { db: Db; writes: unknown[] } {
  const writes: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({ all: () => rows, where: () => ({ get: () => ({ config }) }) }),
    }),
    insert: () => ({
      values: (value: unknown) => ({
        onConflictDoUpdate: () => ({ run: () => writes.push(value) }),
      }),
    }),
  } as unknown as Db;
  return { db, writes };
}

/** An in-memory credential store over `saved`. */
function storeWith(saved = new Map<string, Credential>()): CredentialStore {
  return {
    read: async (id) => saved.get(id),
    list: async () =>
      [...saved].map(([providerId, credential]) => ({ providerId, type: credential.type })),
    modify: async (id, fn) => {
      const next = await fn(saved.get(id));
      if (next) saved.set(id, next);
      return next ?? saved.get(id);
    },
    delete: async (id) => {
      saved.delete(id);
    },
  };
}

const caller = (db: Db, credentials: CredentialStore = storeWith()) =>
  providersRouter.createCaller({ db, chatEndpoint: {} as never, credentials, runner: {} as never });

test('a built-in provider takes no added models', async () => {
  const { db, writes } = rowWith({ enabledModels: ['deepseek-v4-flash'] });
  await expect(caller(db).upsertCustomModel({ id: 'deepseek', model })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(
    caller(db).removeCustomModel({ id: 'deepseek', modelId: 'relay-chat' }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
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

test('an api key is saved as a typed credential, revealed, and cleared', async () => {
  const saved = new Map<string, Credential>();
  const api = caller(rowWith({}).db, storeWith(saved));
  await api.setCredentials({ id: 'deepseek', plaintext: 'sk-test' });
  expect(saved.get('deepseek')).toEqual({ type: 'api_key', key: 'sk-test' });
  expect(await api.getCredentials({ id: 'deepseek' })).toBe('sk-test');
  await api.clearCredentials({ id: 'deepseek' });
  expect(await api.getCredentials({ id: 'deepseek' })).toBeNull();
});

test('an oauth token is never revealed as a key', async () => {
  const saved = new Map<string, Credential>([
    ['openai-codex', { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }],
  ]);
  const api = caller(rowWith({}).db, storeWith(saved));
  expect(await api.getCredentials({ id: 'openai-codex' })).toBeNull();
});

test('the provider list reports credentials the store can read', async () => {
  const rows = [
    { id: 'deepseek', enabled: true, config: null, credentialsEncrypted: null },
    { id: 'openai-codex', enabled: true, config: null, credentialsEncrypted: Buffer.from('x') },
  ];
  const saved = new Map<string, Credential>([['deepseek', { type: 'api_key', key: 'sk-test' }]]);
  const listed = await caller(rowWith({}, rows).db, storeWith(saved)).list();
  expect(Object.fromEntries(listed.map((p) => [p.id, p.hasCredentials]))).toEqual({
    deepseek: true,
    'openai-codex': false,
  });
});
