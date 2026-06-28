import { execFileSync } from 'node:child_process';
import { createLogger } from './log';

const log = createLogger('shell-path');
const DELIM = '__ATRIUM_ENV__';

/**
 * GUI-launched apps on macOS/Linux inherit a truncated environment — none of the
 * variables the user exports from their shell rc (PATH, but also API tokens and
 * config), the classic "works in the terminal, fails from the Dock" gap. Resolve
 * the real login-shell environment once at startup and merge it into process.env,
 * so spawned MCP servers — and the env-var config fields (envPassthrough /
 * headersFromEnv / bearerTokenEnvVar) — see what the terminal does.
 *
 * PATH is merged (prepend + dedupe) so a misbehaving rc can only add dirs, never
 * drop ours; every other shell var fills in only where we don't already have one,
 * leaving the Electron/Node runtime vars untouched. No-op on Windows (GUI
 * processes inherit the full env there) or when resolution fails.
 */
export function loadShellEnv(): void {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // -ilc loads the login + interactive rc files where users set vars; the
    // delimiters fence `env`'s output off from any banner/MOTD the rc prints.
    const out = execFileSync(shell, ['-ilc', `echo -n "${DELIM}"; env; echo -n "${DELIM}"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const body = out.split(DELIM)[1];
    if (!body) return;

    for (const line of body.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      if (key === 'PATH') {
        process.env.PATH = mergePath(value, process.env.PATH);
      } else if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    log.warn('could not load the login-shell environment; using the inherited one', err);
  }
}

/** Prepend the shell PATH onto the inherited one, de-duping, so we never drop dirs. */
function mergePath(shellPath: string, current: string | undefined): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const dir of [...shellPath.split(':'), ...(current ?? '').split(':')]) {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      merged.push(dir);
    }
  }
  return merged.join(':');
}
