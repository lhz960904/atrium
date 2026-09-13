import { decryptJson, encryptJson } from '@main/platform/safe-storage';
import { type McpSecrets, mcpSecretsSchema } from './config';

/*
 * safeStorage-encrypt/decrypt the secret half of an MCP server config, over the
 * platform's generic JSON sealing, so MCP secrets get the same keyring-backed
 * protection as every other stored secret. Kept apart from ./config because it
 * pulls in Electron, which config's unit tests must not.
 */

export function encryptSecrets(secrets: McpSecrets): Buffer {
  return encryptJson(mcpSecretsSchema.parse(secrets));
}

export function decryptSecrets(blob: Buffer | null | undefined): McpSecrets {
  if (!blob) return {};
  return mcpSecretsSchema.parse(decryptJson(blob));
}
