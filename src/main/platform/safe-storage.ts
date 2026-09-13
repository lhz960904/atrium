// Lazy require: electron only exists in the app runtime, so importing it at the
// top would make every module that stores a secret unloadable under tests.
const safeStorage = (): typeof import('electron').safeStorage =>
  (require('electron') as typeof import('electron')).safeStorage;

/**
 * Seal a JSON-serializable value into an OS-encrypted BLOB, for columns like
 * `providers.credentials_encrypted`. The key lives in the system keyring
 * (Keychain / DPAPI / libsecret), so a copied database is unreadable on
 * another machine or account.
 *
 * Nothing here knows what it is encrypting: callers own the shape, and the
 * matching decrypt is an unchecked cast, so validate on the way out.
 */
export function encryptJson(value: unknown): Buffer {
  const storage = safeStorage();
  if (!storage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption unavailable — refusing to store secrets in plaintext.');
  }
  return storage.encryptString(JSON.stringify(value));
}

export function decryptJson<T>(buf: Buffer): T {
  return JSON.parse(safeStorage().decryptString(buf)) as T;
}
