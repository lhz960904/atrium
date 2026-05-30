import { safeStorage } from 'electron';

/** safeStorage-encrypt a JSON value into the BLOB stored in providers.credentials_encrypted. */
export function encryptCredentials(value: unknown): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'safeStorage encryption unavailable — refusing to store credentials in plaintext.',
    );
  }
  return safeStorage.encryptString(JSON.stringify(value));
}

export function decryptCredentials<T>(buf: Buffer): T {
  return JSON.parse(safeStorage.decryptString(buf)) as T;
}
