import { randomUUID } from 'node:crypto';
import type { Session } from '@earendil-works/pi-agent-core';
import { createRunJournal } from '@main/conversation/journal';
import {
  compactThread,
  openThreadCalls,
  openThreadSession,
  resolveThreadWorkspace,
  runnableHistory,
  setThreadTitle,
  settleThreadCalls,
  threadHistory,
  touchThread,
} from '@main/conversation/threads';
import { splitUserMessage } from '@main/conversation/ui-messages';
import type { Db } from '@main/db';
import { recordUsage } from '@main/db/usage';
import { getComputerUseHelper } from '@main/platform/computer-use';
import { getSettings } from '@main/settings/conf';
import { createLogger } from '@main/utils/log';
import type { AtriumUIMessage } from '@shared/chat';
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { Message } from '@shared/protocol';
import { mcpManager } from '../mcp/manager';
import { buildMcpTools } from '../mcp/tool-adapter';
import { modelPricing } from '../providers/models/catalog';
import { makeGetApiKey, piStreamFn, resolvePiModel } from '../providers/pi-model';
import { supportsImageToolResults } from '../providers/resolve';
import { BackgroundShells, LocalSandbox } from '../sandbox';
import { getSkills } from '../skills/registry';
import { getTools } from '../tools';
import { preserveActiveSkill } from '../tools/builtins/skill';
import { preserveTodos } from '../tools/builtins/todo';
import { type Resolution, resultFor } from './approvals';
import { foldHistory } from './compaction';
import { type Complete, createCompleter } from './complete';
import { runAgent } from './run';
import { startThreadRun } from './runs';
import { createSummarizer } from './summarize';
import { generateThreadTitle } from './title';

const log = createLogger('runner');

/** One turn to run on a thread. */
export type RunRequest = {
  threadId: string;
  providerId: string;
  modelId: string;
  permissionMode?: PermissionMode;
  /** A new user turn to append before the run starts. */
  userMessage?: AtriumUIMessage;
  /** Extend the run with this id — answering the calls it parked — instead of
   *  opening a new one. */
  resumeRunId?: string;
  /** What the user decided about the calls the resumed run parked. */
  resolutions?: Resolution[];
};

/** How a turn ended, for a caller that isn't reading the event stream. */
export type RunOutcome = {
  runId: string;
  status: 'ok' | 'error';
  error?: string;
  /** The stored assistant message, when the run produced one. */
  messageId?: string;
};

export type RunHandle = { runId: string; settled: Promise<RunOutcome> };

/** A thread to fold on demand, and the model that writes the summary. */
export type CompactRequest = { threadId: string; providerId: string; modelId: string };

/** Continue the run that parked these calls, with what the user decided. */
export type ResumeRequest = Omit<RunRequest, 'userMessage' | 'resumeRunId' | 'resolutions'> & {
  runId: string;
  decisions: Resolution[];
};

/**
 * The composition root for a turn: everything a run needs — workspace, sandbox,
 * model, tools, permissions, persistence — is assembled here and nowhere else.
 *
 * It exists so that starting a turn is a function call rather than an HTTP
 * request. The chat endpoint and the scheduler are both callers; neither can
 * see how a run is put together, and neither has to reach the other through the
 * loopback interface to start one.
 */
export type Runner = {
  /**
   * Start a turn. Returns once the thread's event log exists — a caller can
   * subscribe to the stream immediately — with a promise for the outcome.
   * Throws synchronously when the request can't run at all (an unknown model).
   */
  start(request: RunRequest): RunHandle;
  /**
   * Answer the calls a run parked and let it continue. Null when none of the
   * decisions name a call that is still open — the session is the authority, so
   * a client working from a stale view can only ask for less than it thinks.
   */
  resume(request: ResumeRequest): Promise<RunHandle | null>;
  /**
   * Record decisions without running the model — a cancelled clarification,
   * where the user has taken the turn back and will send again themselves. The
   * calls still have to be closed, or the next request's history carries an
   * unpaired call. Reports how many were settled.
   */
  settle(threadId: string, decisions: Resolution[]): Promise<number>;
  /**
   * Fold a thread's history now, at the user's request. Reports whether
   * anything was folded — a conversation shorter than the floor folds nothing.
   */
  compact(request: CompactRequest): Promise<boolean>;
  dispose(): void;
};

/**
 * Resolve the auto-review reviewer model. Prefers the dedicated setting; when
 * unset, falls back to this turn's chat model so auto-review works out of the
 * box. Returns undefined (→ auto-review prompts) when nothing resolves — a
 * removed model.
 */
function resolveReviewer(
  db: Db,
  fallback: { providerId: string; modelId: string },
): Complete | undefined {
  const configured = getSettings('permissions.reviewerModel');
  const picked = configured ?? fallback;
  try {
    const model = resolvePiModel(db, picked.providerId, picked.modelId);
    log.info(
      `reviewer = ${picked.providerId}/${picked.modelId}${configured ? '' : ' (inherited chat model)'}`,
    );
    return createCompleter({ model, streamFn: piStreamFn, getApiKey: makeGetApiKey(db) });
  } catch (err) {
    log.info(`reviewer unresolved (${picked.providerId}/${picked.modelId}) → prompts: ${err}`);
    return undefined;
  }
}

/**
 * When a run first opened. A continuation reports the moment the run began, not
 * the moment it resumed, so the card it extends doesn't appear to restart.
 */
async function runStartedAt(session: Session, runId: string): Promise<number> {
  const [started] = await session.findRecords({ type: 'operation_started', runId, limit: 1 });
  return started?.timestamp ?? Date.now();
}

export function createRunner(deps: { db: Db; projectlessRoot: string }): Runner {
  const { db } = deps;
  // Long-running shells (dev servers, watchers) outlive a turn, so the registry
  // is one instance held for the runner's lifetime, not per-run.
  const bgShells = new BackgroundShells();

  function start(request: RunRequest): RunHandle {
    const { threadId, providerId, modelId } = request;
    // The thread's workspace: its project's directory, or the projectless
    // fallback. Drives the sandbox and the tools below.
    const workspaceRoot = resolveThreadWorkspace(db, threadId, deps.projectlessRoot);
    const abort = new AbortController();
    const sandbox = new LocalSandbox(workspaceRoot);
    const skills = getSkills();
    const mode = request.permissionMode ?? DEFAULT_PERMISSION_MODE;
    const supportsImages = supportsImageToolResults(providerId, modelId);
    const computerUse =
      process.platform === 'darwin' && getSettings('computerUse.enabled')
        ? getComputerUseHelper()
        : undefined;
    const piModel = resolvePiModel(db, providerId, modelId);
    // A continuation extends the run it answers, so the model's next turns
    // land in that same stored run instead of opening a second one.
    const runId = request.resumeRunId ?? randomUUID();
    // Resolve the reviewer only when auto-review can actually use it; a
    // misconfigured/removed model resolves to undefined, so auto-review simply
    // falls back to prompting rather than failing the turn.
    const review =
      mode === 'auto-review' ? resolveReviewer(db, { providerId, modelId }) : undefined;

    let result: Awaited<ReturnType<typeof runAgent>> | undefined;
    const finished = startThreadRun(
      threadId,
      async (piLog) => {
        // The conversation lives in the thread's session, created with its
        // first turn. Opening the run and appending the turn that started it
        // happen before the history is read, so the loop sees them.
        const session = await openThreadSession(db, threadId, workspaceRoot);
        const journal = createRunJournal({
          session,
          runId,
          resuming: request.resumeRunId !== undefined,
        });
        const prompt = request.userMessage
          ? {
              id: request.userMessage.id,
              message: splitUserMessage(request.userMessage).message as Message,
            }
          : undefined;
        await journal.begin(prompt);
        // Sending counts as reading: a thread must never flash unread from
        // the user's own message.
        touchThread(db, threadId, { markRead: prompt !== undefined });
        const openedAt = await runStartedAt(session, runId);

        result = await runAgent({
          runId,
          providerId,
          modelId,
          piModel,
          streamFn: piStreamFn,
          getApiKey: makeGetApiKey(db),
          messages: runnableHistory(await session.findEntriesOnBranch({ order: 'oldestFirst' })),
          workspaceRoot,
          threadId,
          db,
          sandbox,
          skills,
          permissionMode: mode,
          permission: { mode, rules: getSettings('permissions.trustRules'), review },
          resolutions: request.resolutions,
          journal,
          openedAt,
          persistCheckpoint: (fold) => compactThread(db, threadId, fold),
          abortSignal: abort.signal,
          emit: piLog.append,
          recordUsage: (u) =>
            recordUsage(db, { threadId, kind: 'chat', ...u }, modelPricing(u.modelId)),
          generateTitle: getSettings('general.autoGenerateTitle')
            ? ({ messages, complete }) =>
                generateThreadTitle({
                  messages,
                  complete,
                  onTitle: (title) => {
                    setThreadTitle(db, threadId, title);
                    piLog.append({ type: 'notice', name: 'title', payload: { data: { title } } });
                  },
                })
            : undefined,
          onSettled: () => computerUse?.hideOverlay(),
          buildTools: (run) =>
            getTools({
              sandbox,
              workspaceRoot,
              run,
              skills,
              // A nested loop (the task tool) runs on the same handles as this turn.
              engine: { model: piModel, streamFn: piStreamFn, getApiKey: makeGetApiKey(db) },
              bgShells,
              supportsImageToolResults: supportsImages,
              computerUse,
              mcpTools: buildMcpTools(mcpManager.catalog(), mcpManager, {
                supportsImageToolResults: supportsImages,
                workspaceRoot,
              }),
            }),
        });
      },
      abort,
    );

    return {
      runId,
      settled: finished.then(() => ({
        runId,
        status: result?.status ?? 'error',
        error: result?.error ?? (result ? undefined : 'the run ended without reporting'),
        messageId: result?.stored ? runId : undefined,
      })),
    };
  }

  return {
    start,

    async resume({ threadId, runId, decisions, ...rest }) {
      const open = await openThreadCalls(db, threadId);
      const resolutions = decisions.filter((d) => open.has(d.toolCallId));
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
      const piModel = resolvePiModel(db, providerId, modelId);
      // Forced compaction is aggressive on purpose: the automatic path keeps a
      // quarter of the window, so a short chat folds nothing — but the user
      // asked to compact now, so only the recent floor is kept.
      const folded = await foldHistory({
        messages: history,
        summarize: createSummarizer({
          model: piModel,
          streamFn: piStreamFn,
          getApiKey: makeGetApiKey(db),
        }),
        contextWindow: piModel.contextWindow,
        preservers: [preserveTodos, preserveActiveSkill],
        keepRecentTokens: 0,
      });
      if (!folded) return false;
      await compactThread(db, threadId, folded);
      log.info(
        `forced compaction folded ${history.length - folded.retainedTail.length} of ${history.length} messages`,
      );
      return true;
    },

    dispose() {
      bgShells.killAll();
    },
  };
}
