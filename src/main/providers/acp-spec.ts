import { join } from 'node:path';
import { app } from 'electron';
import type { AcpSpec } from '../agent/acp/registry';
import { getProviderManifest } from './manifest';

/**
 * Resolve a local-CLI provider to its ACP launch spec. Native-ACP CLIs (Gemini)
 * run their own binary off PATH; adapter-based ones (Codex / Claude) run the
 * official adapter bin we install into node_modules/.bin.
 *
 * The adapter bin path assumes node_modules sits under the app dir — true in dev.
 * A packaged build must unpack the adapter bins out of the asar (electron-builder
 * asarUnpack) and resolve there; tracked as a packaging follow-up.
 */
export function resolveAcpSpec(providerId: string, cwd: string): AcpSpec | null {
  const m = getProviderManifest(providerId);
  if (!m || m.kind !== 'local-cli') return null;
  if (m.acp.via === 'binary') {
    return { providerId, cwd, command: m.acp.command, args: [...m.acp.args] };
  }
  return {
    providerId,
    cwd,
    command: join(app.getAppPath(), 'node_modules', '.bin', m.acp.bin),
    args: [],
  };
}
