import type { AuthMethod } from '@agentclientprotocol/sdk';
import { AcpSession } from './session';

export type AcpSpec = {
  providerId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export type AcquireResult =
  | { ok: true; session: AcpSession; sessionId: string }
  | { ok: false; authMethods: AuthMethod[] };

type Connect = (spec: AcpSpec) => AcpSession;
const defaultConnect: Connect = (s) => AcpSession.spawn(s.command, s.args, s.cwd, s.env);

/**
 * Per-thread registry of long-lived ACP sessions — a main-process singleton.
 * Reusing one session per thread is what keeps the external agent's own
 * conversation context across turns (a fresh session per turn would forget
 * everything). Switching a thread's provider disposes the old session; a
 * not-signed-in session is never cached so a retry after login starts clean.
 * `connect` is injectable so the reuse logic is testable without a subprocess.
 */
export class AcpSessionRegistry {
  private readonly byThread = new Map<
    string,
    { session: AcpSession; providerId: string; sessionId: string }
  >();

  constructor(private readonly connect: Connect = defaultConnect) {}

  /**
   * Reuse the thread's live session (same provider) or start a fresh one.
   * `resume` is the persisted session id from a prior app run — used only on a
   * cold start (no live session), to reconnect the agent's context via load.
   */
  async acquire(threadId: string, spec: AcpSpec, resume?: string): Promise<AcquireResult> {
    const existing = this.byThread.get(threadId);
    if (existing && existing.providerId === spec.providerId) {
      return { ok: true, session: existing.session, sessionId: existing.sessionId };
    }
    if (existing) {
      existing.session.dispose();
      this.byThread.delete(threadId);
    }

    const session = this.connect(spec);
    const { authMethods, sessionId } = await session.start(spec.cwd, resume);
    if (authMethods.length > 0) {
      session.dispose();
      return { ok: false, authMethods };
    }
    const id = sessionId ?? '';
    this.byThread.set(threadId, { session, providerId: spec.providerId, sessionId: id });
    return { ok: true, session, sessionId: id };
  }

  /** Drop a thread's session (e.g. thread deleted). */
  dispose(threadId: string): void {
    const entry = this.byThread.get(threadId);
    if (!entry) return;
    entry.session.dispose();
    this.byThread.delete(threadId);
  }

  /** Kill every session — call on app quit so no adapter is orphaned. */
  disposeAll(): void {
    for (const entry of this.byThread.values()) entry.session.dispose();
    this.byThread.clear();
  }
}
