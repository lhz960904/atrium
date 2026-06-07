import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  type Agent,
  type Client,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk';

/** The sinks for a single prompt turn — swapped in for the duration of prompt(). */
export type AcpTurnHandlers = {
  /** Each session/update notification from the agent (text, thoughts, tool calls, plan…). */
  onUpdate: (update: SessionNotification['update']) => void;
  /** The agent asks the user to approve a tool call; resolve with the chosen outcome. */
  onPermission: (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
};

/**
 * Spawn an external ACP agent CLI and wrap its stdio as an ACP Stream. stderr is
 * inherited so the adapter's diagnostics reach our logs.
 */
export function spawnAcpStream(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): { child: ReturnType<typeof spawn>; stream: Stream } {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] });
  // Swallow pipe-level errors (e.g. EPIPE when the process never started) so they
  // don't crash main; the real failure surfaces via the child 'error' handler.
  child.stdin?.on('error', () => {});
  child.stdout?.on('error', () => {});
  // Cast through unknown: node:stream's web types and the DOM ReadableStream lib
  // differ in getReader's signature, so a direct cast is rejected under the
  // renderer's DOM lib even though this only runs in main.
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin as Writable) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout as Readable) as unknown as ReadableStream<Uint8Array>,
  );
  return { child, stream };
}

/**
 * Long-lived client-side ACP session driving an external agent (Claude Code /
 * Codex / Gemini): handshake once (initialize → newSession), then many prompt
 * turns over the same process so the agent keeps its conversation context across
 * turns. Each prompt swaps in that turn's sinks, so the session's notifications
 * and permission requests route to the current turn's stream. The Stream is
 * injected (child optional) so the protocol logic is testable against an
 * in-memory fake agent with no subprocess.
 */
export class AcpSession {
  private readonly conn: Agent;
  private sessionId: string | null = null;
  private turn: AcpTurnHandlers | null = null;
  private spawnError: Error | null = null;
  private readonly spawnRejecters = new Set<(e: Error) => void>();

  constructor(
    stream: Stream,
    private readonly child?: { kill: () => void },
  ) {
    const client: Client = {
      sessionUpdate: async (note) => this.turn?.onUpdate(note.update),
      requestPermission: async (req) =>
        this.turn ? this.turn.onPermission(req) : { outcome: { outcome: 'cancelled' } },
    };
    this.conn = new ClientSideConnection(() => client, stream);
  }

  /** Spawn the adapter and build a session around its stdio. `notFound` is the
   *  message to surface when the binary is missing (ENOENT). */
  static spawn(
    command: string,
    args: string[],
    cwd: string,
    env?: NodeJS.ProcessEnv,
    notFound?: string,
  ): AcpSession {
    const { child, stream } = spawnAcpStream(command, args, cwd, env);
    const session = new AcpSession(stream, child);
    // A spawn failure (ENOENT = adapter not installed, EACCES, …) arrives as an
    // async 'error' event; with no listener Node crashes the whole process. Catch
    // it, turn ENOENT into an actionable message, and fail start()/in-flight ops.
    child.on('error', (err: NodeJS.ErrnoException) => {
      const e =
        err.code === 'ENOENT'
          ? new Error(
              notFound ??
                `${command} not found — install the CLI/adapter (npm i -g …) and make sure it's on your PATH.`,
            )
          : err;
      session.spawnError = e;
      for (const reject of session.spawnRejecters) reject(e);
    });
    return session;
  }

  /** A promise that rejects when the adapter process fails to spawn. */
  private spawnFailure(): { promise: Promise<never>; cleanup: () => void } {
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<never>((_, rej) => {
      reject = rej;
      if (this.spawnError) rej(this.spawnError);
      else this.spawnRejecters.add(rej);
    });
    promise.catch(() => {}); // observed via race; keep the raw promise from warning
    return { promise, cleanup: () => this.spawnRejecters.delete(reject) };
  }

  /**
   * Negotiate the protocol and open a session rooted at cwd. Pass `resume` (a
   * prior session id) to reconnect the agent's earlier conversation across app
   * restarts via session/load — it re-streams history (dropped here since no turn
   * is active) and restores context; on an unsupported or stale session it falls
   * back to a fresh one. Throws (rather than crashing) when the adapter can't
   * spawn. Returns the session id to persist for next time. Auth is the agent's
   * own concern — we don't gate on it (auth methods are merely "available", not
   * "required"); an unauthenticated agent surfaces its error on the first turn.
   */
  async start(cwd: string, resume?: string): Promise<{ sessionId: string }> {
    if (this.spawnError) throw this.spawnError;
    const fail = this.spawnFailure();
    try {
      const init = await Promise.race([
        this.conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
        fail.promise,
      ]);
      if (resume && init.agentCapabilities?.loadSession && this.conn.loadSession) {
        try {
          await this.conn.loadSession({ sessionId: resume, cwd, mcpServers: [] });
          this.sessionId = resume;
          return { sessionId: resume };
        } catch {
          // Stored session is gone/unloadable — fall through to a fresh one.
        }
      }
      const session = await this.conn.newSession({ cwd, mcpServers: [] });
      this.sessionId = session.sessionId;
      return { sessionId: session.sessionId };
    } finally {
      fail.cleanup();
    }
  }

  /** Run one prompt turn with this turn's sinks; resolves with the stop reason. */
  async prompt(content: ContentBlock[], handlers: AcpTurnHandlers): Promise<string> {
    if (!this.sessionId) throw new Error('AcpSession.prompt called before start()');
    this.turn = handlers;
    try {
      const res = await this.conn.prompt({ sessionId: this.sessionId, prompt: content });
      return res.stopReason;
    } finally {
      this.turn = null;
    }
  }

  /** Cancel the in-flight turn; pending permission requests resolve as cancelled. */
  async cancel(): Promise<void> {
    if (this.sessionId) await this.conn.cancel({ sessionId: this.sessionId });
  }

  /** Kill the adapter process. The session is unusable afterward. */
  dispose(): void {
    this.child?.kill();
  }
}
