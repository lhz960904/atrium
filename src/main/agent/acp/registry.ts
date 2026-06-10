import { AcpSession } from './session';

export type AcpSpec = {
  providerId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Human name + install package, used to phrase a "not installed" error. */
  label?: string;
  install?: string;
};

export type AcquireResult = { session: AcpSession; sessionId: string };

type Connect = (spec: AcpSpec) => AcpSession;
const defaultConnect: Connect = (s) =>
  AcpSession.spawn(s.command, s.args, s.cwd, s.env, notInstalledMessage(s));

function notInstalledMessage(s: AcpSpec): string | undefined {
  if (!s.install) return undefined;
  return `${s.label ?? s.command} is not installed. Run: npm i -g ${s.install} (and make sure it's on your PATH).`;
}

type Entry = { session: AcpSession; providerId: string; sessionId: string; lru: number };

/** Live ACP sessions to keep at once. Each holds a spawned adapter process, so
 *  this bounds how many an app that never quits can accumulate. */
const DEFAULT_MAX_SESSIONS = 6;

/**
 * Per-thread registry of long-lived ACP sessions — a main-process singleton.
 * Reusing one session per thread is what keeps the external agent's own
 * conversation context across turns (a fresh session per turn would forget
 * everything). Switching a thread's provider disposes the old session; a
 * not-signed-in session is never cached so a retry after login starts clean.
 * Bounded to `maxSessions` live processes (LRU): an evicted thread re-spawns and
 * resumes via session/load on its next turn, so only the warm start is lost.
 * `connect` is injectable so the reuse logic is testable without a subprocess.
 */
export class AcpSessionRegistry {
  private readonly byThread = new Map<string, Entry>();
  private seq = 0;

  constructor(
    private readonly connect: Connect = defaultConnect,
    private readonly maxSessions = DEFAULT_MAX_SESSIONS,
  ) {}

  /**
   * Reuse the thread's live session (same provider) or start a fresh one.
   * `resume` is the persisted session id from a prior app run — used only on a
   * cold start (no live session), to reconnect the agent's context via load.
   * Throws if the adapter can't start (e.g. not installed); a dead session is
   * never cached, so the next attempt retries cleanly.
   */
  async acquire(threadId: string, spec: AcpSpec, resume?: string): Promise<AcquireResult> {
    const existing = this.byThread.get(threadId);
    if (existing && existing.providerId === spec.providerId) {
      existing.lru = ++this.seq;
      return { session: existing.session, sessionId: existing.sessionId };
    }
    if (existing) {
      existing.session.dispose();
      this.byThread.delete(threadId);
    }

    const session = this.connect(spec);
    let sessionId: string;
    try {
      sessionId = (await session.start(spec.cwd, resume)).sessionId;
    } catch (err) {
      session.dispose();
      throw err;
    }
    this.byThread.set(threadId, {
      session,
      providerId: spec.providerId,
      sessionId,
      lru: ++this.seq,
    });
    this.evictOverflow(threadId);
    return { session, sessionId };
  }

  /**
   * Keep the live-session count under the cap by disposing the least-recently-used
   * idle session (never the one just acquired, never one mid-turn). The killed
   * adapter's thread keeps its persisted session binding, so its next turn just
   * pays a resume (spawn + session/load) — the conversation is never lost.
   */
  private evictOverflow(keepThreadId: string): void {
    while (this.byThread.size > this.maxSessions) {
      let victim: string | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [tid, e] of this.byThread) {
        if (tid === keepThreadId || e.session.isBusy()) continue;
        if (e.lru < oldest) {
          oldest = e.lru;
          victim = tid;
        }
      }
      if (victim === null) break; // every over-cap session is busy; let it ride
      this.byThread.get(victim)?.session.dispose();
      this.byThread.delete(victim);
    }
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
