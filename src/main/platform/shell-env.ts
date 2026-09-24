import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { createLogger } from '@main/utils/log';

const log = createLogger('shell-env');
const DELIM = '__ATRIUM_ENV__';

/**
 * A login shell can take several seconds to start behind a heavy rc (compinit
 * auditing, nvm, corporate network calls). Resolution runs off the critical path
 * now, so the cap is generous — better to wait and capture the real env than to
 * time out and fall back to the truncated GUI one. It bounds the whole
 * resolution rather than one attempt, so the fallback shells below can never
 * multiply the wait.
 */
const RESOLVE_TIMEOUT_MS = 10_000;

/**
 * Given to the shell we spawn, never to the app. A plugin that updates itself or
 * starts a multiplexer while the rc loads turns resolution into an unbounded
 * wait, and the first flag lets a user's own rc skip its slow work the same way.
 * These keys are dropped on the way back so our own values cannot leak into the
 * app environment, and from there into every subprocess it spawns.
 */
const QUIET_ENV: Record<string, string> = {
  ATRIUM_RESOLVING_ENVIRONMENT: '1',
  DISABLE_AUTO_UPDATE: 'true',
  ZSH_TMUX_AUTOSTART: 'false',
  ZSH_TMUX_AUTOSTARTED: 'true',
};

/** Tried in order when the user's own shell cannot dump a POSIX environment. */
const FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash'];

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

/**
 * The user's shell first, then POSIX fallbacks: a shell that does not speak
 * `-ilc` fails immediately, and dropping to one that does is better than
 * running with the GUI environment. All attempts share one deadline.
 */
async function resolveShellEnv(): Promise<void> {
  if (process.platform === 'win32') return;
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  const seen = new Set<string>();
  for (const shell of [process.env.SHELL, ...FALLBACK_SHELLS]) {
    if (!shell || seen.has(shell)) continue;
    seen.add(shell);
    const budget = deadline - Date.now();
    if (budget <= 0) break;
    try {
      const dump = stripVTControlCharacters(await runEnvDump(shell, budget));
      const body = dump.split(DELIM)[1];
      if (!body) continue;
      mergeEnv(body);
      return;
    } catch (err) {
      log.warn(`could not read the environment from ${shell}`, err);
    }
  }
  log.warn('could not load the login-shell environment; using the inherited one');
}

/**
 * Run the login + interactive shell and capture `env`. `command` bypasses an
 * alias or function of that name, stdin is /dev/null so an interactive shell can
 * never block reading input, and the delimiters fence the env output off from
 * any banner/MOTD the rc prints. Rejects on spawn failure (e.g. the shell binary
 * is missing) or when the shell outruns its budget.
 */
function runEnvDump(shell: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      shell,
      ['-ilc', `echo -n "${DELIM}"; command env; echo -n "${DELIM}"; exit`],
      { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...QUIET_ENV } },
    );
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`login-shell env resolution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
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

/** Fold the shell's view of the environment into ours, without overwriting it. */
function mergeEnv(body: string): void {
  for (const line of body.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    if (key in QUIET_ENV) continue;
    const value = line.slice(eq + 1);
    if (key === 'PATH') {
      process.env.PATH = mergePath(value, process.env.PATH);
    } else if (!(key in process.env)) {
      process.env[key] = value;
    }
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
