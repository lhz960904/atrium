import { execFileSync } from 'node:child_process';
import { createLogger } from './log';

const log = createLogger('shell-path');
const DELIM = '__ATRIUM_PATH__';

/**
 * GUI-launched apps on macOS/Linux inherit a truncated PATH (no homebrew/nvm/etc.),
 * so spawned MCP stdio servers (npx/uvx/python) can't be found even when installed
 * — the classic "works in the terminal, fails from the Dock" gap. Resolve the
 * user's real login-shell PATH once at startup and merge it into process.env.PATH,
 * so subprocess lookups match what they get in their terminal.
 *
 * Merges (prepend + dedupe) rather than replaces, so a misbehaving rc file can
 * only add directories, never drop the ones we already have. No-op on Windows
 * (GUI processes inherit the full PATH there) or when resolution fails.
 */
export function fixPath(): void {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // -ilc loads the login + interactive rc files where users set PATH; the
    // delimiters fence the value off from any banner/MOTD the rc prints.
    const out = execFileSync(shell, ['-ilc', `echo "${DELIM}$PATH${DELIM}"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const resolved = out.split(DELIM)[1]?.trim();
    if (!resolved) return;

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const dir of [...resolved.split(':'), ...(process.env.PATH ?? '').split(':')]) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        merged.push(dir);
      }
    }
    process.env.PATH = merged.join(':');
  } catch (err) {
    log.warn('could not resolve login-shell PATH; using the inherited one', err);
  }
}
