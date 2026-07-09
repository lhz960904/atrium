import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import readline from 'node:readline';
import { createLogger } from '../log';

const log = createLogger('computer-use-helper');

export interface HelperResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve: (response: HelperResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Long-lived bridge to the native "Atrium Computer Use" helper. One request
 * per line on stdin (`{id, method, params}`), one response per line on stdout
 * (`{id, ok, result}`), matched by id.
 *
 * Plan B: the helper is spawned directly, so macOS attributes its TCC
 * responsibility to Atrium (the parent) — the helper borrows Atrium's
 * Accessibility / Screen Recording grant rather than holding its own. The
 * binary is still a separately-signed bundle; only the launch skips the
 * disclaim step that would give it an independent identity.
 */
export class ComputerUseHelper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly binaryPath: string) {}

  call(method: string, params: Record<string, unknown> = {}): Promise<HelperResponse> {
    const child = this.ensureChild();
    const id = `r${++this.seq}`;
    return new Promise<HelperResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  dispose(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.rejectAll(new Error('Computer Use helper disposed.'));
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) {
      return this.child;
    }

    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const reader = readline.createInterface({ input: child.stdout });
    reader.on('line', (line) => this.onLine(line));

    // Consume stderr into the app log. An unread pipe can fill and stall the
    // helper, and a crash's diagnostics would otherwise be lost.
    const stderrReader = readline.createInterface({ input: child.stderr });
    stderrReader.on('line', (line) => {
      if (line.trim()) {
        log.warn(line);
      }
    });

    child.on('exit', (code) => {
      this.child = null;
      if (code) {
        log.warn(`helper exited (code ${code})`);
      }
      this.rejectAll(new Error(`Computer Use helper exited (code ${code ?? 'unknown'}).`));
    });
    child.on('error', (error) => {
      this.child = null;
      log.error('helper failed to spawn', error);
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });

    this.child = child;
    return child;
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let response: HelperResponse;
    try {
      response = JSON.parse(trimmed) as HelperResponse;
    } catch {
      // stdout may carry non-JSON diagnostics; ignore anything unparseable.
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
