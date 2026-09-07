import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { providers } from '../db/schema';
import { createLogger } from '../log';
import { decryptCredentials, encryptCredentials } from './credentials';

const log = createLogger('providers');

/**
 * Read a stored blob as a credential. An API key written by the settings panel
 * carries no type tag; the two shapes are otherwise identical, so tagging is
 * the whole conversion.
 */
export function toCredential(stored: unknown): Credential | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  if ('type' in stored) return stored as Credential;
  const key = (stored as { key?: unknown }).key;
  return typeof key === 'string' && key ? { type: 'api_key', key } : undefined;
}

/**
 * The engine's credential storage, on the same encrypted blob the settings UI
 * already writes API keys to — one credential per provider, safeStorage-sealed.
 *
 * The engine reads through this rather than being handed a key per call,
 * because an OAuth credential is not a constant: it is refreshed in place, and
 * `modify` is the serialized read-modify-write that keeps two concurrent
 * requests from racing a rotated token into a lost refresh.
 */
export function createCredentialStore(db: Db): CredentialStore {
  /** Per-provider write chains — the store's whole point is that writes queue. */
  const chains = new Map<string, Promise<unknown>>();

  const readRow = (providerId: string): Credential | undefined => {
    const row = db
      .select({ blob: providers.credentialsEncrypted })
      .from(providers)
      .where(eq(providers.id, providerId))
      .get();
    if (!row?.blob) return undefined;
    try {
      return toCredential(decryptCredentials<unknown>(row.blob as Buffer));
    } catch (err) {
      log.warn(`credential for ${providerId} is unreadable: ${err}`);
      return undefined;
    }
  };

  const writeRow = (providerId: string, credential: Credential | undefined): void => {
    const blob = credential === undefined ? null : encryptCredentials(credential);
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
        writeRow(providerId, undefined);
      });
    },
  };
}
