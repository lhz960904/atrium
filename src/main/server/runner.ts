import { randomUUID } from 'node:crypto';
import type { Session } from '@earendil-works/pi-agent-core';
import type { AtriumUIMessage } from '@shared/chat';
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { Message } from '@shared/protocol';
import { mcpManager } from '../agent/mcp/manager';
import { buildMcpTools } from '../agent/mcp/tool-adapter';
import { modelPricing } from '../agent/models/catalog';
import type { Resolution } from '../agent/pi/approvals';
import { type Complete, createCompleter } from '../agent/pi/complete';
import { generateThreadTitle } from '../agent/pi/title';
import { asStored } from '../agent/pi/vocabulary';
import { runAgent } from '../agent/run';
import { BackgroundShells, LocalSandbox } from '../agent/sandbox';
import { getSkills } from '../agent/skills/registry';
import { getTools } from '../agent/tools';
import { getComputerUseHelper } from '../computer-use';
import type { Db } from '../db';
import { recordUsage } from '../db/usage';
import { createLogger } from '../log';
import { makeGetApiKey, piStreamFn, resolvePiModel } from '../providers/pi-model';
import { supportsImageToolResults } from '../providers/resolve';
import { createRunJournal } from '../session/journal';
import { projectHistory } from '../session/project';
import { compactThread, openThreadSession, touchThread } from '../session/threads';
import { getSettings } from '../settings/conf';
import { resolveThreadWorkspace, setThreadTitle } from './persist';
import { splitUserMessage } from './persist-convert';
import { startThreadRun } from './resumable';

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

  return {
    start(request: RunRequest): RunHandle {
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
            ? (splitUserMessage(request.userMessage).message as Message)
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
            messages: asStored(
              projectHistory(await session.findEntriesOnBranch({ order: 'oldestFirst' })),
            ),
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
    },

    dispose() {
      bgShells.killAll();
    },
  };
}
