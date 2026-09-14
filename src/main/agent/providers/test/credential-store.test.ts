import { expect, mock, test } from 'bun:test';
import type { Db } from '@main/db';

mock.module('@main/platform/safe-storage', () => ({
  encryptJson: (value: unknown) => Buffer.from(JSON.stringify(value)),
  decryptJson: (blob: Buffer) => JSON.parse(blob.toString()),
}));
const { createCredentialStore } = await import('../credential-store');

/** One provider row whose sealed blob starts as `initial`, counting inserts. */
function providerRow(initial?: unknown) {
  let blob: Buffer | null = initial === undefined ? null : Buffer.from(JSON.stringify(initial));
  let inserts = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ get: () => (blob ? { blob } : undefined) }),
        all: () => (blob ? [{ id: 'deepseek', blob }] : []),
      }),
    }),
    insert: () => ({
      values: (row: { credentialsEncrypted: Buffer }) => ({
        onConflictDoUpdate: () => ({
          run: () => {
            inserts++;
            blob = row.credentialsEncrypted;
          },
        }),
      }),
    }),
    update: () => ({
      set: (row: { credentialsEncrypted: Buffer | null }) => ({
        where: () => ({
          run: () => {
            blob = row.credentialsEncrypted;
          },
        }),
      }),
    }),
  } as unknown as Db;
  return { db, inserts: () => inserts };
}

test('a saved api key reads back as a typed credential', async () => {
  const store = createCredentialStore(providerRow().db);
  await store.modify('deepseek', async () => ({ type: 'api_key', key: 'sk-test' }));
  expect(await store.read('deepseek')).toEqual({ type: 'api_key', key: 'sk-test' });
  expect(await store.list()).toEqual([{ providerId: 'deepseek', type: 'api_key' }]);
});

test('a blob without a credential type reads as no credential', async () => {
  const store = createCredentialStore(providerRow({ key: 'sk-untyped' }).db);
  expect(await store.read('deepseek')).toBeUndefined();
  expect(await store.list()).toEqual([]);
});

test('deleting clears the credential without inserting a row', async () => {
  const row = providerRow({ type: 'api_key', key: 'sk-test' });
  const store = createCredentialStore(row.db);
  await store.delete('deepseek');
  expect(await store.read('deepseek')).toBeUndefined();
  expect(row.inserts()).toBe(0);
});
