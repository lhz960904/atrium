import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import { Refusal } from '@main/utils/refusal';
import type { CustomModel, CustomProvider } from '@shared/custom-model';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import {
  addableProviders,
  addProvider,
  createCustomProvider,
  listProviders,
  mergeProviderConfig,
  readApiKey,
  removeCustomModel,
  saveApiKey,
  setProviderEnabled,
  updateCustomProvider,
  upsertCustomModel,
} from '../store';

/**
 * Which ids may be claimed, what "added" implies, and which providers have a
 * model list of their own — rules that used to be reachable only by sending a
 * request, and so had no test.
 */

function store(): { db: Db; raw: Database } {
  const raw = new Database(':memory:');
  raw.run(`CREATE TABLE providers (
    id text PRIMARY KEY NOT NULL, enabled integer DEFAULT false NOT NULL, config text,
    credentials_encrypted blob, oauth_encrypted blob,
    created_at integer DEFAULT 0 NOT NULL, updated_at integer DEFAULT 0 NOT NULL)`);
  return { db: drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db, raw };
}

const defined: CustomProvider = {
  name: 'My Gateway',
  baseUrl: 'https://gw.example.com/v1',
  api: 'openai-completions',
};

const model = (id: string): CustomModel => ({
  id,
  name: id,
  reasoning: false,
  input: ['text'],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4_000,
});

const configOf = (db: Db, id: string) =>
  (db
    .select()
    .from(schema.providers)
    .all()
    .find((row) => row.id === id)?.config ?? {}) as Record<string, unknown>;

const noCredentials = { list: async () => [] } as unknown as Parameters<typeof listProviders>[1];

test('adding is the whole step: the provider is on, and off the add picker', async () => {
  const { db } = store();
  expect(addableProviders(db).some((p) => p.id === 'anthropic')).toBe(true);

  addProvider(db, 'anthropic');

  // No separate "turn it on" — a provider in the list doing nothing is the
  // state everyone forgets to leave.
  const [row] = db.select().from(schema.providers).all();
  expect(row).toMatchObject({ id: 'anthropic', enabled: true });
  expect(addableProviders(db).some((p) => p.id === 'anthropic')).toBe(false);
  expect((await listProviders(db, noCredentials)).map((p) => p.id)).toEqual(['anthropic']);
});

test('an id Atrium does not ship is not addable', () => {
  const { db } = store();
  expect(() => addProvider(db, 'not-a-provider')).toThrow(/not a known provider/);
  expect(db.select().from(schema.providers).all()).toEqual([]);
});

test('a defined provider cannot claim an id that is already taken', () => {
  const { db } = store();
  // Shadowing a built-in would make two different products answer to one id.
  expect(() => createCustomProvider(db, 'anthropic', defined)).toThrow(
    /already the id of a built-in/,
  );

  createCustomProvider(db, 'gateway', defined);
  expect(() => createCustomProvider(db, 'gateway', defined)).toThrow(/already in use/);
  expect(db.select().from(schema.providers).all()).toHaveLength(1);
});

test('defining a provider adds it, and it shows up as editable', async () => {
  const { db } = store();
  createCustomProvider(db, 'gateway', defined);

  const [view] = await listProviders(db, noCredentials);
  expect(view).toMatchObject({
    id: 'gateway',
    name: 'My Gateway',
    enabled: true,
    custom: true,
    defaultBaseUrl: defined.baseUrl,
  });
});

test('only a provider you defined can be edited or given models', () => {
  const { db } = store();
  addProvider(db, 'anthropic');

  expect(() => updateCustomProvider(db, 'anthropic', defined)).toThrow(Refusal);
  // A built-in's catalog is the engine's alone.
  expect(() => upsertCustomModel(db, 'anthropic', model('m1'))).toThrow(Refusal);
  expect(() => removeCustomModel(db, 'anthropic', 'm1')).toThrow(Refusal);
});

test('renaming a model replaces it instead of leaving the old id behind', () => {
  const { db } = store();
  createCustomProvider(db, 'gateway', defined);
  upsertCustomModel(db, 'gateway', model('old'));
  upsertCustomModel(db, 'gateway', model('kept'));

  upsertCustomModel(db, 'gateway', model('new'), 'old');

  const ids = (configOf(db, 'gateway').customModels as CustomModel[]).map((m) => m.id);
  expect(ids.sort()).toEqual(['kept', 'new']);
});

test('a config update merges into what is stored rather than replacing it', () => {
  const { db } = store();
  createCustomProvider(db, 'gateway', defined);
  upsertCustomModel(db, 'gateway', model('m1'));

  mergeProviderConfig(db, 'gateway', { apiBase: 'https://elsewhere.example.com' });

  const config = configOf(db, 'gateway');
  expect(config.apiBase).toBe('https://elsewhere.example.com');
  // The provider definition and its models are not collateral.
  expect(config.customProvider).toMatchObject({ name: 'My Gateway' });
  expect(config.customModels).toHaveLength(1);
});

test('a view says whether a credential exists, never what it is', async () => {
  const { db } = store();
  addProvider(db, 'anthropic');
  setProviderEnabled(db, 'anthropic', false);

  const withKey = {
    list: async () => [{ providerId: 'anthropic' }],
    read: async () => ({ type: 'api_key', key: 'sk-secret-value' }),
  } as unknown as Parameters<typeof listProviders>[1];

  const [view] = await listProviders(db, withKey);
  expect(view).toMatchObject({ id: 'anthropic', enabled: false, hasCredentials: true });
  // The panel is told one bit: that a key is there. Reading it is its own call.
  expect(JSON.stringify(view)).not.toContain('sk-secret-value');
});

/** A credential store the test writes into, standing in for the engine's. */
function credentialsWith(saved = new Map<string, Credential>()): CredentialStore {
  return {
    list: async () => [...saved.keys()].map((providerId) => ({ providerId })),
    read: async (id: string) => saved.get(id),
    modify: async (id: string, next: (current?: Credential) => Promise<Credential>) => {
      saved.set(id, await next(saved.get(id)));
    },
    delete: async (id: string) => {
      saved.delete(id);
    },
  } as unknown as CredentialStore;
}

test('an api key is saved as a typed credential, revealed, and cleared', async () => {
  const saved = new Map<string, Credential>();
  const credentials = credentialsWith(saved);

  await saveApiKey(credentials, 'deepseek', 'sk-test');
  expect(saved.get('deepseek')).toEqual({ type: 'api_key', key: 'sk-test' });
  expect(await readApiKey(credentials, 'deepseek')).toBe('sk-test');

  await credentials.delete('deepseek');
  expect(await readApiKey(credentials, 'deepseek')).toBeNull();
});

test('an oauth token is never revealed as a key', async () => {
  const credentials = credentialsWith(
    new Map<string, Credential>([
      ['openai-codex', { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }],
    ]),
  );
  // A token is not a key, and the reveal must never hand one out as though it were.
  expect(await readApiKey(credentials, 'openai-codex')).toBeNull();
});

test('the list reports credentials the store can read, per provider', async () => {
  const { db } = store();
  addProvider(db, 'anthropic');
  addProvider(db, 'openai');
  const credentials = credentialsWith(
    new Map<string, Credential>([['anthropic', { type: 'api_key', key: 'sk-test' }]]),
  );

  const listed = await listProviders(db, credentials);
  expect(Object.fromEntries(listed.map((p) => [p.id, p.hasCredentials]))).toMatchObject({
    anthropic: true,
    openai: false,
  });
});
