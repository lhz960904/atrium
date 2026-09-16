import { randomUUID } from 'node:crypto';
import { compactThread, threadHistory } from '@main/conversation/threads';
import type { Db } from '@main/db';
import { createLogger } from '@main/utils/log';
import type { DecideInteraction } from '@shared/interactions';
import type { EventEnvelope } from '@shared/protocol';
import { foldHistory } from '../context/compaction';
import { createSummarizer } from '../context/summarize';
import { resolvePiModel } from '../providers/models';
import { BackgroundShells } from '../sandbox';
import { preserveActiveSkill } from '../tools/builtins/skill';
import { preserveTodos } from '../tools/builtins/todo';
import { executeRun, type RunInput } from './execute-run';
import {
  createPendingInteractions,
  InteractionConflict,
  type PendingInteractions,
} from './pending-interactions';
import { EventBuffer } from './stream/run-event-buffer';

const log = createLogger('runner');

/**
 * Finished logs kept so a reader can still rejoin a run that just ended;
 * beyond this the oldest finished ones are dropped. A log whose run is still
 * going is never evicted.
 */
const MAX_FINISHED_LOGS = 64;

/** Start a run using the selected provider/model. */
export type RunRequest = RunInput & { providerId: string; modelId: string };

/** Public outcome for HTTP/scheduler callers; cancellation isn't an error. */
export type RunOutcome = {
  runId: string;
  status: 'ok' | 'error';
  error?: string;
  messageId?: string;
};

export type RunHandle = {
  runId: string;
  settled: Promise<RunOutcome>;
};
export type CompactRequest = { threadId: string; providerId: string; modelId: string };

export type Runner = {
  abort(threadId: string): boolean;
  isRunning(threadId: string): boolean;
  runningThreadIds(): string[];
  subscribe(threadId: string, fromSeq: number): ReadableStream<EventEnvelope> | null;
  /** Returns once the stream exists. Invalid models and busy threads throw synchronously. */
  start(request: RunRequest): RunHandle;
  /** Hand a decision to the run waiting on it; throws when that run is not waiting. */
  respond(threadId: string, input: DecideInteraction): 'accepted' | 'already_accepted';
  compact(request: CompactRequest): Promise<boolean>;
  /** Stop accepting runs, cancel the live ones and wait for them to settle. */
  dispose(): Promise<void>;
};

type ActiveRun = {
  runId: string;
  abort: AbortController;
  pending: PendingInteractions;
  settled: Promise<RunOutcome>;
};

/**
 * Application-lifetime run management: admission, cancellation, decisions,
 * replay and shared shells. All per-run assembly and recording belongs to
 * executeRun.
 */
export class RunManager implements Runner {
  private readonly db: Db;
  private readonly projectlessRoot: string;
  private readonly bgShells = new BackgroundShells();
  /** The runs a caller can still address — decide, abort, await. A run leaves
   *  the moment it settles. */
  private readonly active = new Map<string, ActiveRun>();
  /** One event log per thread, kept past its run so a reader can rejoin one
   *  that just ended. Outlives `active`, which is why they are separate. */
  private readonly buffers = new Map<string, EventBuffer>();
  private disposed = false;
  private closing: Promise<void> | undefined;

  constructor(deps: { db: Db; projectlessRoot: string }) {
    this.db = deps.db;
    this.projectlessRoot = deps.projectlessRoot;
  }

  private assertIdle(threadId: string): void {
    if (this.active.has(threadId)) throw new Error(`Thread ${threadId} is already running`);
  }

  /** The thread's log for this run, superseding whatever it had. */
  private openBuffer(threadId: string): EventBuffer {
    const buffer = new EventBuffer();
    // Reinsert so Map order stays usable as an LRU for evicting finished logs.
    this.buffers.delete(threadId);
    this.buffers.set(threadId, buffer);
    for (const [id, kept] of this.buffers) {
      if (this.buffers.size <= MAX_FINISHED_LOGS) break;
      if (kept.closed) this.buffers.delete(id);
    }
    return buffer;
  }

  start({ providerId, modelId, ...input }: RunRequest): RunHandle {
    const { threadId } = input;
    if (this.disposed) throw new Error('Runner is disposed');
    this.assertIdle(threadId);
    // Admission stays synchronous, before replacing this thread's replay buffer.
    const model = resolvePiModel(this.db, providerId, modelId);
    const runId = randomUUID();
    const abort = new AbortController();
    const pending = createPendingInteractions({ runId, abort });

    const eventLog = this.openBuffer(threadId);
    const settled = executeRun({
      input,
      runId,
      model,
      db: this.db,
      projectlessRoot: this.projectlessRoot,
      bgShells: this.bgShells,
      signal: abort.signal,
      pending,
      emit: eventLog.emit,
    })
      .then(
        (result): RunOutcome => ({
          runId: result.runId,
          status: result.status === 'failed' ? 'error' : 'ok',
          error: result.error,
          messageId: result.messageId,
        }),
        (error): RunOutcome => {
          const errorText = error instanceof Error ? error.message : String(error);
          log.warn(`run ${runId} failed: ${errorText}`);
          return { runId, status: 'error', error: errorText };
        },
      )
      .finally(() => {
        // Whatever the run did, its readers have to see the log end.
        eventLog.close();
        this.active.delete(threadId);
      });
    this.active.set(threadId, { runId, abort, pending, settled });

    return { runId, settled };
  }

  abort(threadId: string): boolean {
    const run = this.active.get(threadId);
    if (!run) return false;
    run.pending.cancel('user_cancelled');
    return true;
  }

  isRunning(threadId: string): boolean {
    return this.active.has(threadId);
  }

  runningThreadIds(): string[] {
    return [...this.active.keys()];
  }

  subscribe(threadId: string, fromSeq: number): ReadableStream<EventEnvelope> | null {
    return this.buffers.get(threadId)?.subscribe(fromSeq) ?? null;
  }

  respond(threadId: string, input: DecideInteraction): 'accepted' | 'already_accepted' {
    const run = this.active.get(threadId);
    if (!run || run.runId !== input.runId || run.abort.signal.aborted) {
      throw new InteractionConflict('The interaction is no longer active.');
    }
    return run.pending.respond(input);
  }

  async compact({ threadId, providerId, modelId }: CompactRequest): Promise<boolean> {
    // A waiting run still owns the thread's history.
    this.assertIdle(threadId);
    const history = await threadHistory(this.db, threadId);
    const model = resolvePiModel(this.db, providerId, modelId);
    const folded = await foldHistory({
      messages: history,
      summarize: createSummarizer(model),
      contextWindow: model.contextWindow,
      preservers: [preserveTodos, preserveActiveSkill],
      // User-requested compaction keeps only the recent floor.
      keepRecentTokens: 0,
    });
    if (!folded) return false;
    await compactThread(this.db, threadId, folded);
    return true;
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.disposed = true;
    // Cancelling is a request; a run is only really over once its own
    // recording and cleanup have finished, which is what callers wait for.
    const running = [...this.active.values()].map((run) => run.settled);
    for (const run of this.active.values()) run.pending.cancel('app_shutdown');
    this.bgShells.killAll();
    this.closing = Promise.allSettled(running).then(() => undefined);
    return this.closing;
  }
}
