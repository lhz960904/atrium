import { spawn } from 'node:child_process';
import { killProcessTree } from './kill-tree';

/**
 * Registry of long-running shell processes that outlive a single tool call —
 * dev servers, watchers, `tail -f`. The handle is held (exit not awaited) and
 * output accumulates in a capped buffer; reads are cursor-based, returning only
 * output produced since the last read. Must be a main-process singleton — the
 * per-request LocalSandbox is rebuilt each turn and can't hold processes across
 * calls.
 */

const MAX_BUFFER = 1_000_000;

/** The slice of a spawned child process we depend on — injectable so tests need no real process. */
export type ShellProc = {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  kill(): void;
};
export type SpawnShell = (command: string, cwd: string) => ShellProc;

export type ShellOutput = {
  output: string;
  running: boolean;
  exitCode: number | null;
  /** Some early output aged out of the capped buffer before this read. */
  truncated: boolean;
};

type Session = {
  proc: ShellProc;
  command: string;
  buffer: string;
  cursor: number;
  truncated: boolean;
  running: boolean;
  exitCode: number | null;
};

const defaultSpawn: SpawnShell = (command, cwd) => {
  // A pipe (not a PTY): dev servers and watchers detect the non-tty stdout and
  // emit plain text instead of color + spinner redraws, which keeps the buffer
  // readable for the model. `detached` puts the shell in its own process group
  // so kill() can reap the dev server / watcher it forked, not just the shell —
  // otherwise kill_shell and app-quit cleanup would leave those orphaned.
  const child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', command], {
    cwd,
    env: process.env,
    detached: true,
  });
  return {
    onData(cb) {
      child.stdout?.on('data', (d: Buffer) => cb(d.toString('utf8')));
      child.stderr?.on('data', (d: Buffer) => cb(d.toString('utf8')));
    },
    onExit(cb) {
      child.on('close', (code) => cb({ exitCode: code ?? 0 }));
    },
    kill() {
      killProcessTree(child);
    },
  };
};

export class BackgroundShells {
  private readonly sessions = new Map<string, Session>();
  private counter = 0;

  constructor(private readonly spawn: SpawnShell = defaultSpawn) {}

  /** Spawn a long-running command and register it. Returns its shell id. */
  start(command: string, cwd: string): string {
    this.counter += 1;
    const id = `bash_${this.counter}`;
    const session: Session = {
      proc: this.spawn(command, cwd),
      command,
      buffer: '',
      cursor: 0,
      truncated: false,
      running: true,
      exitCode: null,
    };
    session.proc.onData((d) => {
      session.buffer += d;
      if (session.buffer.length > MAX_BUFFER) {
        const drop = session.buffer.length - MAX_BUFFER;
        session.buffer = session.buffer.slice(drop);
        session.cursor = Math.max(0, session.cursor - drop);
        session.truncated = true;
      }
    });
    session.proc.onExit(({ exitCode }) => {
      session.running = false;
      session.exitCode = exitCode;
    });
    this.sessions.set(id, session);
    return id;
  }

  /** New output since the last read (advances the cursor). null if id unknown. */
  read(id: string, filter?: string): ShellOutput | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    let output = s.buffer.slice(s.cursor);
    s.cursor = s.buffer.length;
    if (filter && output !== '') {
      try {
        const re = new RegExp(filter);
        output = output
          .split('\n')
          .filter((line) => re.test(line))
          .join('\n');
      } catch {
        // invalid regex: fall through with unfiltered output
      }
    }
    return { output, running: s.running, exitCode: s.exitCode, truncated: s.truncated };
  }

  /** Terminate a running shell. Returns false if the id is unknown. */
  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.running) s.proc.kill();
    return true;
  }

  /** Kill every running shell — call on app quit so no process is orphaned. */
  killAll(): void {
    for (const s of this.sessions.values()) if (s.running) s.proc.kill();
  }
}
