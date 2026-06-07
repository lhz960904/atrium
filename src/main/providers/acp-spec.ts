import type { AcpSpec } from '../agent/acp/registry';
import { getProviderManifest } from './manifest';

/**
 * Resolve a local-CLI provider to its ACP launch spec. Both native-ACP CLIs
 * (gemini --acp) and the adapters (codex-acp / claude-agent-acp) are run by
 * command name off PATH — the user installs them globally (we don't bundle
 * them), and a missing/unauthenticated CLI surfaces as a turn error.
 */
export function resolveAcpSpec(providerId: string, cwd: string): AcpSpec | null {
  const m = getProviderManifest(providerId);
  if (!m || m.kind !== 'local-cli') return null;
  const launch =
    m.acp.via === 'binary'
      ? { command: m.acp.command, args: [...m.acp.args] }
      : { command: m.acp.bin, args: [] };
  return { providerId, cwd, label: m.name, install: m.install, ...launch };
}
