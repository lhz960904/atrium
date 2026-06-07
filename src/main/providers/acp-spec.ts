import type { AcpSpec } from '../agent/acp/registry';
import { getProviderManifest } from './manifest';

/**
 * Resolve a local-CLI provider to its ACP launch spec. Both native-ACP CLIs
 * (gemini --acp) and the adapters (codex-acp / claude-agent-acp) are run by
 * command name off PATH — the user installs them globally (we don't bundle
 * them), and a missing/unauthenticated CLI surfaces as a turn error. `overrides`
 * are the user's saved command/args (args is a space-separated string); each
 * falls back to the manifest default when blank.
 */
export function resolveAcpSpec(
  providerId: string,
  cwd: string,
  overrides?: { command?: string; args?: string },
): AcpSpec | null {
  const m = getProviderManifest(providerId);
  if (!m || m.kind !== 'local-cli') return null;
  const base =
    m.acp.via === 'binary'
      ? { command: m.acp.command, args: [...m.acp.args] }
      : { command: m.acp.bin, args: [] };
  const command = overrides?.command?.trim() || base.command;
  const argsOverride = overrides?.args?.trim();
  const args = argsOverride ? argsOverride.split(/\s+/) : base.args;
  return { providerId, cwd, label: m.name, install: m.install, command, args };
}
