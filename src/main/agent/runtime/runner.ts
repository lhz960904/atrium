import { randomUUID } from 'node:crypto';
import { compactThread, threadHistory } from '@main/conversation/threads';
import type { Db } from '@main/db';
import { createLogger } from '@main/utils/log';
import type { DecideInteraction } from '@shared/interactions';
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
import { createRunEventBuffer } from './stream/run-event-buffer';

const log = createLogger('runner');

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
  subscribe(threadId: string, fromSeq: number): ReadableStream<Uint8Array> | null;
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
export function createRunner(deps: { db: Db; projectlessRoot: string }): Runner {
  const { db } = deps;
  const bgShells = new BackgroundShells();
  const active = new Map<string, ActiveRun>();
  const events = createRunEventBuffer();
  let disposed = false;
  let closing: Promise<void> | undefined;

  function assertIdle(threadId: string): void {
    if (active.has(threadId)) throw new Error(`Thread ${threadId} is already running`);
  }

  function start({ providerId, modelId, ...input }: RunRequest): RunHandle {
    const { threadId } = input;
    if (disposed) throw new Error('Runner is disposed');
    assertIdle(threadId);
    // Admission stays synchronous, before replacing this thread's replay buffer.
    const model = resolvePiModel(db, providerId, modelId);
    const runId = randomUUID();
    const abort = new AbortController();
    const pending = createPendingInteractions({ runId, abort });

    const settled = events
      .produce(threadId, ({ append }) =>
        executeRun({
          input,
          runId,
          model,
          db,
          projectlessRoot: deps.projectlessRoot,
          bgShells,
          signal: abort.signal,
          pending,
          emit: append,
        }),
      )
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
        active.delete(threadId);
      });
    active.set(threadId, { runId, abort, pending, settled });

    return { runId, settled };
  }

  return {
    start,
    abort(threadId) {
      const run = active.get(threadId);
      if (!run) return false;
      run.pending.cancel('user_cancelled');
      return true;
    },
    isRunning: (threadId) => active.has(threadId),
    runningThreadIds: () => [...active.keys()],
    subscribe: events.subscribe,

    respond(threadId, input) {
      const run = active.get(threadId);
      if (!run || run.runId !== input.runId || run.abort.signal.aborted) {
        throw new InteractionConflict('The interaction is no longer active.');
      }
      return run.pending.respond(input);
    },

    async compact({ threadId, providerId, modelId }) {
      // A waiting run still owns the thread's history.
      assertIdle(threadId);
      const history = await threadHistory(db, threadId);
      const model = resolvePiModel(db, providerId, modelId);
      const folded = await foldHistory({
        messages: history,
        summarize: createSummarizer(model),
        contextWindow: model.contextWindow,
        preservers: [preserveTodos, preserveActiveSkill],
        // User-requested compaction keeps only the recent floor.
        keepRecentTokens: 0,
      });
      if (!folded) return false;
      await compactThread(db, threadId, folded);
      return true;
    },

    dispose() {
      if (closing) return closing;
      disposed = true;
      // Cancelling is a request; a run is only really over once its own
      // recording and cleanup have finished, which is what callers wait for.
      const running = [...active.values()].map((run) => run.settled);
      for (const run of active.values()) run.pending.cancel('app_shutdown');
      bgShells.killAll();
      closing = Promise.allSettled(running).then(() => undefined);
      return closing;
    },
  };
}
