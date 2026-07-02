import { spawn } from 'node:child_process';
import { createLogger } from './log';

const log = createLogger('shell-path');
const DELIM = '__ATRIUM_ENV__';

// A login shell can take several seconds to start behind a heavy rc (compinit
// auditing, nvm, corporate network calls). Resolution runs off the critical path
// now, so the cap is generous — better to wait and capture the real env than to
// time out and fall back to the truncated GUI one.
const RESOLVE_TIMEOUT_MS = 10_000;

let pending: Promise<void> | null = null;

/**
 * GUI-launched apps on macOS/Linux inherit a truncated environment — none of the
 * variables the user exports from their shell rc (PATH, but also API tokens and
 * config), the classic "works in the terminal, fails from the Dock" gap. Resolve
 * the real login-shell environment once and merge it into process.env, so spawned
 * MCP servers — and the env-var config fields (envPassthrough / headersFromEnv /
 * bearerTokenEnvVar) — see what the terminal does.
 *
 * Async and memoized. The caller kicks this off during boot but MUST NOT block
 * first paint on it; anything that spawns a subprocess (MCP stdio) awaits the
 * returned promise so it sees the merged PATH. PATH is merged (prepend + dedupe)
 * so a misbehaving rc can only add dirs, never drop ours; every other shell var
 * fills in only where we don't already have one, leaving the Electron/Node
 * runtime vars untouched. No-op on Windows (GUI processes inherit the full env
 * there) or when resolution fails.
 */
export function loadShellEnv(): Promise<void> {
  pending ??= resolveShellEnv();
  return pending;
}

async function resolveShellEnv(): Promise<void> {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const body = (await runEnvDump(shell)).split(DELIM)[1];
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

/**
 * Run the login + interactive shell and capture `env`. stdin is /dev/null so an
 * interactive shell can never block reading input; the delimiters fence the env
 * output off from any banner/MOTD the rc prints. Rejects on spawn failure (e.g.
 * the shell binary is missing) or when the shell outruns the timeout.
 */
function runEnvDump(shell: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ['-ilc', `echo -n "${DELIM}"; env; echo -n "${DELIM}"`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`login-shell env resolution timed out after ${RESOLVE_TIMEOUT_MS}ms`));
    }, RESOLVE_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
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
