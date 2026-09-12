// Lazy require: electron only exists in the app runtime, so importing it at the
// top would make every module that touches credentials unloadable under tests.
const safeStorage = (): typeof import('electron').safeStorage =>
  (require('electron') as typeof import('electron')).safeStorage;

/** safeStorage-encrypt a JSON value into the BLOB stored in providers.credentials_encrypted. */
export function encryptCredentials(value: unknown): Buffer {
  const storage = safeStorage();
  if (!storage.isEncryptionAvailable()) {
    throw new Error(
      'safeStorage encryption unavailable — refusing to store credentials in plaintext.',
    );
  }
  return storage.encryptString(JSON.stringify(value));
}

export function decryptCredentials<T>(buf: Buffer): T {
  return JSON.parse(safeStorage().decryptString(buf)) as T;
}
