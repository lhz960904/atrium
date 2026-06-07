import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  type Agent,
  type AuthMethod,
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

  /** Spawn the adapter and build a session around its stdio. */
  static spawn(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): AcpSession {
    const { child, stream } = spawnAcpStream(command, args, cwd, env);
    return new AcpSession(stream, child);
  }

  /**
   * Negotiate the protocol and open a session rooted at cwd. Pass `resume` (a
   * prior session id) to reconnect the agent's earlier conversation across app
   * restarts via session/load — it re-streams history (dropped here since no
   * turn is active) and restores the agent's context; on an unsupported or
   * stale session it falls back to a fresh one. Returns the agent's auth methods
   * (empty = signed in) and the session id to persist for next time.
   */
  async start(
    cwd: string,
    resume?: string,
  ): Promise<{ authMethods: AuthMethod[]; sessionId: string | null }> {
    const init = await this.conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const authMethods = init.authMethods ?? [];
    if (authMethods.length > 0) return { authMethods, sessionId: null };

    if (resume && init.agentCapabilities?.loadSession && this.conn.loadSession) {
      try {
        await this.conn.loadSession({ sessionId: resume, cwd, mcpServers: [] });
        this.sessionId = resume;
        return { authMethods, sessionId: resume };
      } catch {
        // Stored session is gone/unloadable — fall through to a fresh one.
      }
    }
    const session = await this.conn.newSession({ cwd, mcpServers: [] });
    this.sessionId = session.sessionId;
    return { authMethods, sessionId: session.sessionId };
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
