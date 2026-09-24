import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createLogger } from '@main/utils/log';

const log = createLogger('shell-env');

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
 * Given to the shell we spawn, never to the app. The first two turn our own
 * binary into a plain node interpreter, so it can print the environment the
 * shell built; the rest stop the rc plugins that update themselves or start a
 * multiplexer on load, either of which makes resolution an unbounded wait.
 *
 * Every key here is dropped out of the result. Letting ELECTRON_RUN_AS_NODE
 * through would be the worst of them: it would land in our own environment and
 * bring every Electron process we later spawn up as node instead.
 */
const INJECTED_ENV: Record<string, string> = {
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
  DISABLE_AUTO_UPDATE: 'true',
  ZSH_TMUX_AUTOSTART: 'false',
  ZSH_TMUX_AUTOSTARTED: 'true',
};

/** Tried in order when the user's own shell cannot dump a POSIX environment. */
const FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash'];

/**
 * The payload goes to a descriptor of its own with stdout and stderr discarded,
 * so neither a banner the rc prints nor a job it backgrounds — which keeps
 * writing while the dump runs — can reach what we parse.
 */
const PAYLOAD_FD = 3;

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
 * The user's shell first, then POSIX fallbacks: a shell that speaks neither the
 * login flags nor the descriptor redirect fails immediately, and dropping to one
 * that does beats running with the GUI environment. All attempts share one
 * deadline.
 */
async function resolveShellEnv(): Promise<void> {
  if (process.platform === 'win32') return;
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  const tried = new Set<string>();
  for (const shell of [process.env.SHELL, ...FALLBACK_SHELLS]) {
    if (!shell || tried.has(shell)) continue;
    tried.add(shell);
    const budget = deadline - Date.now();
    if (budget <= 0) break;
    try {
      mergeEnv(await runEnvDump(shell, budget));
      return;
    } catch (err) {
      log.warn(`could not read the environment from ${shell}`, err);
    }
  }
  log.warn('could not load the login-shell environment; using the inherited one');
}

/**
 * Run the login + interactive shell and have it print its environment as JSON.
 * JSON rather than `env` output because a variable whose value spans lines
 * cannot be told apart from the next variable, which both truncates the value
 * and invents a name from the remainder.
 *
 * Settles on `exit`, never on `close`: a process the rc backgrounds inherits the
 * descriptor and holds it open for as long as it lives, so `close` can be hours
 * away — or never — with the whole payload already in hand. The marker itself
 * usually settles this first, as soon as the closing one arrives.
 */
function runEnvDump(shell: string, timeoutMs: number): Promise<Record<string, string>> {
  // A marker fresh per run: a fixed one could occur in a variable's value or in
  // what an rc prints, and would then cut the payload in the wrong place.
  const mark = randomUUID().replaceAll('-', '').slice(0, 12);
  const payload = new RegExp(`${mark}(\\{.*\\})${mark}`);
  const print = `"${mark}" + JSON.stringify(process.env) + "${mark}"`;
  const command = `'${process.execPath}' -p '${print}' >&${PAYLOAD_FD}`;

  return new Promise((resolve, reject) => {
    const child = spawn(shell, ['-i', '-l', '-c', command], {
      // Its own process group, so killing the shell never reaches a daemon the
      // rc legitimately started.
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
      env: { ...process.env, ...INJECTED_ENV },
    });
    const pipe = child.stdio[PAYLOAD_FD] as Readable | undefined;
    let out = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const done = (result: Record<string, string> | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pipe?.destroy();
      child.kill();
      child.unref();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    /** Null until both markers have arrived and what they bracket parses. */
    const captured = (): Record<string, string> | null => {
      const match = payload.exec(out);
      if (!match) return null;
      try {
        return JSON.parse(match[1]) as Record<string, string>;
      } catch {
        return null;
      }
    };

    timer = setTimeout(
      () => done(new Error(`login-shell env resolution timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    pipe?.setEncoding('utf8');
    pipe?.on('data', (chunk: string) => {
      out += chunk;
      const env = captured();
      if (env) done(env);
    });
    child.on('error', (err) => done(err));
    child.on('exit', () => done(captured() ?? new Error(`${shell} printed no environment`)));
  });
}

/** Fold the shell's view of the environment into ours, without overwriting it. */
function mergeEnv(shellEnv: Record<string, string>): void {
  for (const [key, value] of Object.entries(shellEnv)) {
    if (key in INJECTED_ENV) continue;
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
