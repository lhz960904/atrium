import * as pty from 'node-pty';

/**
 * Registry of long-running shell processes that outlive a single tool call —
 * dev servers, watchers, `tail -f`. The handle is held (exit not awaited) and
 * output accumulates in a capped buffer; reads are cursor-based, returning only
 * output produced since the last read. Must be a main-process singleton — the
 * per-request LocalSandbox is rebuilt each turn and can't hold processes across
 * calls.
 */

const MAX_BUFFER = 1_000_000;

/** The slice of node-pty's IPty we depend on — injectable so tests need no real process. */
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
  const shell = process.env.SHELL || '/bin/zsh';
  return pty.spawn(shell, ['-lc', command], {
    cwd,
    env: process.env as Record<string, string>,
    cols: 120,
    rows: 40,
  });
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
