import { randomUUID } from 'node:crypto';
import {
  compactThread,
  openThreadCalls,
  settleThreadCalls,
  threadHistory,
} from '@main/conversation/threads';
import type { Db } from '@main/db';
import { createLogger } from '@main/utils/log';
import { foldHistory } from '../context/compaction';
import { createSummarizer } from '../context/summarize';
import { resolvePiModel } from '../providers/models';
import { BackgroundShells } from '../sandbox';
import { preserveActiveSkill } from '../tools/builtins/skill';
import { preserveTodos } from '../tools/builtins/todo';
import { executeRun, type RunInput } from './execute-run';
import { createRunEventBuffer } from './stream/run-event-buffer';
import { type Resolution, resultFor } from './tool-resolutions';

const log = createLogger('runner');

/** Start or continue a run using the selected provider/model. */
export type RunRequest = RunInput & { providerId: string; modelId: string };

/** Public outcome for HTTP/scheduler callers; cancellation and waiting aren't errors. */
export type RunOutcome = {
  runId: string;
  status: 'ok' | 'error';
  error?: string;
  messageId?: string;
};

export type RunHandle = { runId: string; settled: Promise<RunOutcome> };
export type CompactRequest = { threadId: string; providerId: string; modelId: string };
export type ResumeRequest = Omit<RunRequest, 'userMessage' | 'resumeRunId' | 'resolutions'> & {
  runId: string;
  decisions: Resolution[];
};

export type Runner = {
  abort(threadId: string): boolean;
  isRunning(threadId: string): boolean;
  runningThreadIds(): string[];
  subscribe(threadId: string, fromSeq: number): ReadableStream<Uint8Array> | null;
  /** Returns once the stream exists. Invalid models and busy threads throw synchronously. */
  start(request: RunRequest): RunHandle;
  /** Null when none of the decisions address a still-open call. */
  resume(request: ResumeRequest): Promise<RunHandle | null>;
  /** Settle denials/answers without running the model; returns the number written. */
  settle(threadId: string, decisions: Resolution[]): Promise<number>;
  compact(request: CompactRequest): Promise<boolean>;
  dispose(): void;
};

/**
 * Application-lifetime run management: admission, cancellation, replay and shared
 * shells. All per-run assembly and recording belongs to executeRun.
 */
export function createRunner(deps: { db: Db; projectlessRoot: string }): Runner {
  const { db } = deps;
  const bgShells = new BackgroundShells();
  const active = new Map<string, AbortController>();
  const events = createRunEventBuffer();
  let disposed = false;

  function start({ providerId, modelId, ...input }: RunRequest): RunHandle {
    const { threadId } = input;
    if (disposed) throw new Error('Runner is disposed');
    if (active.has(threadId)) throw new Error(`Thread ${threadId} is already running`);
    // Admission stays synchronous, before replacing this thread's replay buffer.
    const model = resolvePiModel(db, providerId, modelId);
    const runId = input.resumeRunId ?? randomUUID();
    const abort = new AbortController();
    active.set(threadId, abort);

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
      .finally(() => active.delete(threadId));

    return { runId, settled };
  }

  return {
    start,
    abort(threadId) {
      const controller = active.get(threadId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    isRunning: (threadId) => active.has(threadId),
    runningThreadIds: () => [...active.keys()],
    subscribe: events.subscribe,

    async resume({ threadId, runId, decisions, ...rest }) {
      const open = await openThreadCalls(db, threadId);
      const resolutions = decisions.filter((decision) => open.has(decision.toolCallId));
      if (resolutions.length === 0) return null;
      return start({ ...rest, threadId, resumeRunId: runId, resolutions });
    },

    async settle(threadId, decisions) {
      const open = await openThreadCalls(db, threadId);
      const results = decisions.flatMap((decision) => {
        const call = open.get(decision.toolCallId);
        const result = call && resultFor(call, decision);
        return result ? [result] : [];
      });
      await settleThreadCalls(db, threadId, results);
      return results.length;
    },

    async compact({ threadId, providerId, modelId }) {
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
      disposed = true;
      for (const controller of active.values()) controller.abort();
      bgShells.killAll();
    },
  };
}
