import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import type { AtriumUIMessage } from '@shared/chat';
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { mcpManager } from '../agent/mcp/manager';
import { buildMcpTools } from '../agent/mcp/tool-adapter';

import { modelPricing } from '../agent/models/catalog';
import type { Resolution } from '../agent/pi/approvals';
import { toolCallsById } from '../agent/pi/approvals';
import { foldToCheckpoint } from '../agent/pi/compaction';
import { type Complete, createCompleter } from '../agent/pi/complete';
import { createSummarizer } from '../agent/pi/summarize';
import { generateThreadTitle } from '../agent/pi/title';
import { runAgent } from '../agent/run';
import { BackgroundShells, LocalSandbox } from '../agent/sandbox';
import { getSkills } from '../agent/skills/registry';
import { getTools } from '../agent/tools';
import { preserveActiveSkill } from '../agent/tools/builtins/skill';
import { preserveTodos } from '../agent/tools/builtins/todo';
import { getComputerUseHelper } from '../computer-use';
import type { Db } from '../db';
import { recordUsage } from '../db/usage';
import { createLogger } from '../log';
import { makeGetApiKey, piStreamFn, resolvePiModel } from '../providers/pi-model';
import { supportsImageToolResults } from '../providers/resolve';
import { getSettings } from '../settings/conf';
import {
  loadRunRows,
  loadThreadHistory,
  loadThreadMessages,
  persistCheckpoint,
  persistMessage,
  persistRun,
  type RunRow,
  resolveThreadWorkspace,
  resolveToolOutput,
  setThreadTitle,
} from './persist';
import { subscribePiEvents } from './pi-events';
import { abortThreadRun, isThreadRunning, startThreadRun } from './resumable';

export type ChatEndpoint = { port: number; token: string; dispose: () => void };

const PI_SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

/** The POST response is the just-started run's event stream from seq 0. */
function runResponse(threadId: string): Response {
  const sse = subscribePiEvents(threadId, -1);
  return sse
    ? new Response(sse, { headers: PI_SSE_HEADERS })
    : new Response('event log missing', { status: 500 });
}

// Client sends only the latest message (AI SDK persistence best practice);
// the server rebuilds history from the DB. The thread row always exists before
// the chat view can send (the home view creates it, then navigates), so
// threadId is a hard requirement — its absence is a bug, not a degraded mode.
type ChatBody = {
  threadId: string;
  providerId: string;
  modelId: string;
  message: AtriumUIMessage;
  permissionMode?: PermissionMode;
};

/**
 * Localhost HTTP server for AI streaming. Lives alongside electron-trpc:
 * tRPC handles CRUD, this handles the chat stream (AI SDK's happy path is
 * an HTTP Response that useChat consumes). Bound to 127.0.0.1 on a random
 * free port; a per-launch token gates /api/* so other local processes
 * can't drive the user's model credits.
 */
const log = createLogger('chat');

/**
 * Resolve the auto-review reviewer model. Prefers the dedicated setting; when
 * unset, falls back to this turn's chat model so auto-review works out of the
 * box. Returns undefined (→ auto-review prompts) when nothing resolves — a
 * removed model, or the fallback being an external agent whose model we can't
 * drive (an ACP turn has no controllable model to inherit).
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
 * The decisions a resumed message carries for the calls its run left open. The
 * stored rows are the authority on which calls are still waiting; the client's
 * copy of the message carries the user's answer for each.
 */
function resolutionsFor(message: AtriumUIMessage, resumeRows: RunRow[]): Resolution[] {
  if (message.role !== 'assistant' || resumeRows.length === 0) return [];
  const answered = new Set(resumeRows.flatMap((r) => (r.role === 'toolResult' ? [r.id] : [])));
  const open = toolCallsById(resumeRows.map((r) => r.message));
  const out: Resolution[] = [];
  for (const part of message.parts) {
    const p = part as {
      toolCallId?: string;
      state?: string;
      output?: unknown;
      approval?: { approved?: boolean; reason?: string };
    };
    const toolCallId = p.toolCallId;
    if (!toolCallId || answered.has(toolCallId) || !open.has(toolCallId)) continue;
    if (p.state === 'approval-responded') {
      out.push(
        p.approval?.approved
          ? { toolCallId, kind: 'approved' }
          : { toolCallId, kind: 'denied', reason: p.approval?.reason },
      );
    } else if (p.state === 'output-available') {
      out.push({ toolCallId, kind: 'answered', output: p.output });
    }
  }
  return out;
}

export function startHttpServer(deps: {
  db: Db;
  token: string;
  projectlessRoot: string;
}): Promise<ChatEndpoint> {
  const app = new Hono();
  // Long-running shells (dev servers, watchers) outlive a request, so the
  // registry is a single instance held for the server's lifetime, not per-call.
  const bgShells = new BackgroundShells();
  // External CLI agents keep one ACP session per thread (so they remember the
  // conversation across turns), so this registry is also server-lifetime.
  // Renderer is a different origin (localhost:5173 in dev, file:// in prod);
  // CORS must run before auth so the credential-less preflight isn't 401'd.
  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'x-atrium-token'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.use('/api/*', async (c, next) => {
    if (c.req.header('x-atrium-token') !== deps.token) return c.text('unauthorized', 401);
    return next();
  });

  app.post('/api/chat', async (c) => {
    const { threadId, providerId, modelId, message, permissionMode } = await c.req.json<ChatBody>();
    if (!threadId) return c.text('threadId required', 400);

    // Persist the just-sent user message, then rebuild the full history from
    // the DB (the DB is the source of truth, not the client). An assistant
    // message arrives only when a client-side tool (ask_clarification) was just
    // answered and the chat auto-resumed: overwrite the stored call so history
    // carries the answer the model is about to continue from.
    if (message.role === 'user') persistMessage(deps.db, threadId, message);
    const history = loadThreadMessages(deps.db, threadId);

    // Resolve the thread's workspace per request: its project's directory, or
    // the projectless fallback. Drives the sandbox, tools, and ACP spec below.
    const workspaceRoot = resolveThreadWorkspace(deps.db, threadId, deps.projectlessRoot);

    const abort = new AbortController();

    const sandbox = new LocalSandbox(workspaceRoot);
    const skills = getSkills();
    const mode = permissionMode ?? DEFAULT_PERMISSION_MODE;
    const supportsImages = supportsImageToolResults(providerId, modelId);
    const computerUse =
      process.platform === 'darwin' && getSettings('computerUse.enabled')
        ? getComputerUseHelper()
        : undefined;
    // A continuation resumes the run the client is answering (its assistant
    // message id), so the model's next turns extend that same stored run
    // instead of opening a second one.
    const runId = message.role === 'assistant' ? message.id : randomUUID();
    const piModel = resolvePiModel(deps.db, providerId, modelId);
    // A continuation answers calls an earlier turn parked. What the run already
    // stored says which ones are still open; the client's copy of the message
    // says what the user decided about each.
    const resumeRows = message.role === 'assistant' ? loadRunRows(deps.db, runId) : [];
    const resolutions = resolutionsFor(message, resumeRows);
    // The engine runs on pi messages; the entries keep each one's row id so a
    // compaction checkpoint can name the last row it folded away.
    const entries = loadThreadHistory(deps.db, threadId);
    startThreadRun(
      threadId,
      (piLog) =>
        runAgent({
          runId,
          providerId,
          modelId,
          piModel,
          streamFn: piStreamFn,
          getApiKey: makeGetApiKey(deps.db),
          messages: entries.map((entry) => entry.message),
          uiMessages: history,
          workspaceRoot,
          threadId,
          db: deps.db,
          sandbox,
          skills,
          permissionMode: mode,
          permission: {
            mode,
            rules: getSettings('permissions.trustRules'),
            // Resolve the reviewer only when auto-review can actually use it; a
            // misconfigured/removed model resolves to undefined, so auto-review
            // simply falls back to prompting rather than failing the turn.
            review:
              mode === 'auto-review'
                ? resolveReviewer(deps.db, { providerId, modelId })
                : undefined,
          },
          resolutions,
          resumeRows,
          abortSignal: abort.signal,
          emit: piLog.append,
          persist: (rows, opts) => persistRun(deps.db, threadId, runId, rows, opts),
          persistCheckpoint: (checkpoint) =>
            persistCheckpoint(deps.db, threadId, checkpoint, entries[checkpoint.coveredThrough].id),
          recordUsage: (u) =>
            recordUsage(deps.db, { threadId, kind: 'chat', ...u }, modelPricing(u.modelId)),
          generateTitle: getSettings('general.autoGenerateTitle')
            ? ({ messages, complete }) =>
                generateThreadTitle({
                  messages,
                  complete,
                  onTitle: (title) => {
                    setThreadTitle(deps.db, threadId, title);
                    piLog.append({ type: 'notice', name: 'title', payload: { data: { title } } });
                  },
                })
            : undefined,
          onSettled: () => computerUse?.hideOverlay(),
          buildTools: (run) => {
            const toolCtx = {
              sandbox,
              workspaceRoot,
              run,
              skills,
              // A nested loop (the task tool) runs on the same handles as this turn.
              engine: {
                model: piModel,
                streamFn: piStreamFn,
                getApiKey: makeGetApiKey(deps.db),
              },
              bgShells,
              supportsImageToolResults: supportsImages,
              computerUse,
              mcpTools: buildMcpTools(mcpManager.catalog(), mcpManager, {
                supportsImageToolResults: supportsImages,
                workspaceRoot,
              }),
              permission: {
                mode,
                rules: getSettings('permissions.trustRules'),
                // Resolve the reviewer only when auto-review can actually use it; a
                // misconfigured/removed model resolves to undefined, so auto-review
                // simply falls back to prompting rather than failing the turn.
                review:
                  mode === 'auto-review'
                    ? resolveReviewer(deps.db, { providerId, modelId })
                    : undefined,
                abortSignal: abort.signal,
              },
            };
            return getTools(toolCtx);
          },
        }),
      abort,
    );
    return runResponse(threadId);
  });

  // Stop a thread's in-flight generation. Aborts the agent loop server-side
  // (closing the client stream alone can't, since the run is decoupled for
  // resume); whatever was generated so far is persisted as the turn ends.
  app.post('/api/chat/:threadId/abort', (c) => {
    const aborted = abortThreadRun(c.req.param('threadId'));
    return c.json({ aborted });
  });

  // Resolve a client-side tool call (a cancelled clarification) in the DB
  // without running the model — the turn only resumes on the user's next send.
  app.post('/api/chat/:threadId/resolve-clarify', async (c) => {
    const { toolCallId, output } = await c.req.json<{ toolCallId: string; output: unknown }>();
    resolveToolOutput(deps.db, c.req.param('threadId'), toolCallId, output);
    return c.json({ ok: true });
  });

  // Force-compact a thread on demand (user-invoked /compact). Summarizes the
  // history into a checkpoint pair and persists it; the client then reloads to
  // show the divider. Needs a model (for the summary), so the client passes the
  // active provider/model like the chat endpoint.
  app.post('/api/chat/:threadId/compact', async (c) => {
    const threadId = c.req.param('threadId');
    const { providerId, modelId } = await c.req.json<{ providerId: string; modelId: string }>();
    const history = loadThreadHistory(deps.db, threadId);
    // Force-compact is aggressive on purpose: the automatic path keeps a quarter
    // of the window (so a short chat folds nothing), but the user asked to
    // compact now — keep only the recent floor and fold everything before it.
    const piModel = resolvePiModel(deps.db, providerId, modelId);
    const folded = await foldToCheckpoint({
      messages: history.map((entry) => entry.message),
      summarize: createSummarizer({
        model: piModel,
        streamFn: piStreamFn,
        getApiKey: makeGetApiKey(deps.db),
      }),
      contextWindow: piModel.contextWindow,
      preservers: [preserveTodos, preserveActiveSkill],
      keepRecentTokens: 0,
    });
    if (!folded) return c.json({ compacted: false });
    persistCheckpoint(
      deps.db,
      threadId,
      folded.checkpoint,
      history[folded.checkpoint.coveredThrough].id,
    );
    log.info(
      `forced compaction folded ${folded.checkpoint.coveredThrough + 1} of ${history.length} messages`,
    );
    return c.json({ compacted: true });
  });

  // Reconnect endpoint: replay the thread's envelope log from `from`
  // (exclusive) and tail live. 204 when nothing is running — a finished run's
  // message is already in the DB the client seeds from, so replaying its log
  // would duplicate the content.
  app.get('/api/chat/:threadId/pi-events', (c) => {
    if (!isThreadRunning(c.req.param('threadId'))) return c.body(null, 204);
    const raw = Number(c.req.query('from') ?? '-1');
    const sse = subscribePiEvents(c.req.param('threadId'), Number.isFinite(raw) ? raw : -1);
    return sse
      ? new Response(sse, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      : c.body(null, 204);
  });

  // serve() binds asynchronously; the real port arrives in the listening
  // callback (server.address() is null synchronously right after).
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({
        port: info.port,
        token: deps.token,
        dispose: () => {
          bgShells.killAll();
        },
      });
    });
  });
}
