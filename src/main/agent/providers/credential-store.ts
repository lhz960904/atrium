import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import { providers } from '@main/db/schema';
import { decryptJson, encryptJson } from '@main/platform/safe-storage';
import { createLogger } from '@main/utils/log';
import { eq } from 'drizzle-orm';

const log = createLogger('providers');

/**
 * Every provider credential, API key or OAuth token, sealed with safeStorage on
 * the provider's row. The engine resolves requests through it and the settings
 * panel writes through it, so both see one record in one shape.
 *
 * `modify` is a serialized read-modify-write per provider, because an OAuth token
 * is refreshed in place and two concurrent requests must not race a rotated token
 * into a lost refresh. The queue lives on the instance, so the app shares one.
 */
export function createCredentialStore(db: Db): CredentialStore {
  const chains = new Map<string, Promise<unknown>>();

  const readRow = (providerId: string): Credential | undefined => {
    const row = db
      .select({ blob: providers.credentialsEncrypted })
      .from(providers)
      .where(eq(providers.id, providerId))
      .get();
    if (!row?.blob) return undefined;
    try {
      const stored = decryptJson<Partial<Credential> | null>(row.blob as Buffer);
      // Only a typed credential is one the engine can resolve.
      return stored?.type ? (stored as Credential) : undefined;
    } catch (err) {
      log.warn(`credential for ${providerId} is unreadable: ${err}`);
      return undefined;
    }
  };

  const writeRow = (providerId: string, credential: Credential): void => {
    const blob = encryptJson(credential);
    db.insert(providers)
      .values({ id: providerId, enabled: true, credentialsEncrypted: blob })
      .onConflictDoUpdate({
        target: providers.id,
        set: { credentialsEncrypted: blob, updatedAt: new Date() },
      })
      .run();
  };

  const enqueue = <T>(providerId: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    chains.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  };

  return {
    async read(providerId) {
      return readRow(providerId);
    },

    async list(): Promise<readonly CredentialInfo[]> {
      return db
        .select({ id: providers.id, blob: providers.credentialsEncrypted })
        .from(providers)
        .all()
        .flatMap((row) => {
          if (!row.blob) return [];
          const credential = readRow(row.id);
          return credential ? [{ providerId: row.id, type: credential.type }] : [];
        });
    },

    modify(providerId, fn) {
      return enqueue(providerId, async () => {
        const current = readRow(providerId);
        const next = await fn(current);
        if (next === undefined) return current;
        writeRow(providerId, next);
        return next;
      });
    },

    delete(providerId) {
      return enqueue(providerId, async () => {
        // Clearing a credential never adds a provider that isn't in the list.
        db.update(providers)
          .set({ credentialsEncrypted: null, updatedAt: new Date() })
          .where(eq(providers.id, providerId))
          .run();
      });
    },
  };
}
