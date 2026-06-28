import { decryptCredentials, encryptCredentials } from '../../providers/credentials';
import { type McpSecrets, mcpSecretsSchema } from './config';

/*
 * safeStorage-encrypt/decrypt the secret half of an MCP server config. Reuses
 * the providers' generic credential crypto (JSON value -> encrypted BLOB), so
 * MCP secrets get the same Keychain-backed protection. Kept apart from ./config
 * because it pulls in Electron, which config's unit tests must not.
 */

export function encryptSecrets(secrets: McpSecrets): Buffer {
  return encryptCredentials(mcpSecretsSchema.parse(secrets));
}

export function decryptSecrets(blob: Buffer | null | undefined): McpSecrets {
  if (!blob) return {};
  return mcpSecretsSchema.parse(decryptCredentials(blob));
}
