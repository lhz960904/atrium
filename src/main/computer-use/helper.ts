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

export interface CallOptions {
  /** Reject (and reset the helper) if no response arrives within this many ms. */
  timeoutMs?: number;
  /** Reject as soon as this fires, so a chat abort can interrupt a live action. */
  signal?: AbortSignal;
}

// The helper serves one request at a time on its main thread, so a single hung
// request wedges every future one. Bound each call; on timeout kill the child
// (it respawns on the next call) rather than leaving the whole bridge stuck.
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

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

  call(
    method: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<HelperResponse> {
    const child = this.ensureChild();
    const id = `r${++this.seq}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const { signal } = options;
    return new Promise<HelperResponse>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      const onAbort = (): void => {
        cleanup();
        reject(new Error('Computer use action aborted.'));
      };
      timer = setTimeout(() => {
        cleanup();
        // A hung request (e.g. a slow accessibility walk on System Settings)
        // blocks the single-threaded helper's next request too, so kill the
        // child — ensureChild respawns it on the following call.
        this.child?.kill();
        this.child = null;
        reject(new Error(`Computer use action timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (response) => {
          cleanup();
          resolve(response);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
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

  /**
   * Collapse the on-screen activity cursor at turn end. The helper's own
   * idle-hide never fires (it blocks on readLine with no runloop to drain the
   * timer), so the app hides the overlay explicitly. No-op when the helper never
   * started — no action ran this turn, so nothing is on screen.
   */
  hideOverlay(): void {
    if (!this.child) {
      return;
    }
    void this.call('hide_overlay').catch(() => {});
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
