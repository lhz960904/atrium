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

export type AcpHandlers = {
  /** Each session/update notification from the agent (text, thoughts, tool calls, plan…). */
  onUpdate: (update: SessionNotification['update']) => void;
  /** The agent asks the user to approve a tool call; resolve with the chosen outcome. */
  onPermission: (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
};

/**
 * Spawn an external ACP agent CLI and wrap its stdio as an ACP Stream. stderr is
 * inherited so the adapter's diagnostics reach our logs. The returned child is
 * the caller's to kill on turn/abort/app-quit.
 */
export function spawnAcpStream(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): { child: ReturnType<typeof spawn>; stream: Stream } {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
  );
  return { child, stream };
}

/**
 * Client-side ACP session driving an external agent (Claude Code / Codex /
 * Gemini) over a Stream: handshake (initialize → newSession), then prompt turns.
 * The agent's session/update notifications and permission requests are forwarded
 * to the injected handlers. The Stream is injected (not spawned here) so this is
 * testable against an in-memory fake agent with no real subprocess.
 */
export class AcpSession {
  private readonly conn: Agent;
  private sessionId: string | null = null;

  constructor(stream: Stream, handlers: AcpHandlers) {
    const client: Client = {
      sessionUpdate: async (note) => handlers.onUpdate(note.update),
      requestPermission: (req) => handlers.onPermission(req),
    };
    this.conn = new ClientSideConnection(() => client, stream);
  }

  /**
   * Negotiate the protocol and open a session rooted at cwd. Returns the agent's
   * auth methods — an empty list means the user is already logged in; a non-empty
   * list means authentication is required before prompting.
   */
  async start(cwd: string): Promise<{ authMethods: AuthMethod[] }> {
    const init = await this.conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = await this.conn.newSession({ cwd, mcpServers: [] });
    this.sessionId = session.sessionId;
    return { authMethods: init.authMethods ?? [] };
  }

  /** Run one prompt turn; resolves with the agent's stop reason when the turn ends. */
  async prompt(content: ContentBlock[]): Promise<string> {
    if (!this.sessionId) throw new Error('AcpSession.prompt called before start()');
    const res = await this.conn.prompt({ sessionId: this.sessionId, prompt: content });
    return res.stopReason;
  }

  /** Cancel the in-flight turn; pending permission requests resolve as cancelled. */
  async cancel(): Promise<void> {
    if (this.sessionId) await this.conn.cancel({ sessionId: this.sessionId });
  }
}
