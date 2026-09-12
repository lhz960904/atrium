import { serve } from '@hono/node-server';
import type { Resolution } from '@main/agent/runtime/approvals';
import { resultFor } from '@main/agent/runtime/approvals';
import { foldToCheckpoint } from '@main/agent/runtime/compaction';
import type { Runner } from '@main/agent/runtime/runner';
import { abortThreadRun, isThreadRunning } from '@main/agent/runtime/runs';
import { subscribePiEvents } from '@main/agent/runtime/stream/event-log';
import { createSummarizer } from '@main/agent/runtime/summarize';
import { preserveActiveSkill } from '@main/agent/tools/builtins/skill';
import { preserveTodos } from '@main/agent/tools/builtins/todo';
import type { Db } from '@main/db';
import { createLogger } from '@main/log';
import { makeGetApiKey, piStreamFn, resolvePiModel } from '@main/providers/pi-model';
import {
  compactThread,
  openThreadCalls,
  settleThreadCalls,
  threadHistory,
} from '@main/session/threads';
import type { AtriumUIMessage } from '@shared/chat';
import type { PermissionMode } from '@shared/permissions';
import type { ToolResultMessage } from '@shared/protocol';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export type ChatEndpoint = { port: number; token: string };

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

/** What every request that starts a run has to say. */
type RunBody = {
  threadId: string;
  providerId: string;
  modelId: string;
  permissionMode?: PermissionMode;
};

// The client sends only the turn it just wrote; the server rebuilds the history
// from the DB. The thread row always exists before the chat view can send (the
// home view creates it, then navigates), so threadId is a hard requirement —
// its absence is a bug, not a degraded mode.
type ChatBody = RunBody & { message: AtriumUIMessage };

/** The user's answers for the calls a run parked, addressed to that run. */
type DecisionsBody = { runId: string; decisions: Resolution[] };

const log = createLogger('chat');

/**
 * Localhost HTTP server for AI streaming. Lives alongside electron-trpc: tRPC
 * handles CRUD, this handles the chat stream — a long-lived HTTP response the
 * renderer reads as SSE. Bound to 127.0.0.1 on a random free port; a per-launch
 * token gates /api/* so other local processes can't drive the user's model
 * credits.
 *
 * This layer only translates: it turns a request into a run request and a run's
 * event log into an SSE body. How a run is assembled belongs to the runner.
 */
export function startHttpServer(deps: {
  db: Db;
  token: string;
  runner: Runner;
}): Promise<ChatEndpoint> {
  const app = new Hono();
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
    if (message?.role !== 'user') return c.text('chat takes a user message', 400);

    deps.runner.start({ threadId, providerId, modelId, permissionMode, userMessage: message });
    return runResponse(threadId);
  });

  /**
   * Continue a run with what the user decided about the calls it parked — an
   * approval answered, a clarification filled in. The decisions travel as
   * decisions: the stored rows say which calls are still open, so a client that
   * is out of date can only ask for less than it thinks, never for more.
   */
  app.post('/api/chat/:threadId/resume', async (c) => {
    const threadId = c.req.param('threadId');
    const { providerId, modelId, permissionMode, runId, decisions } = await c.req.json<
      RunBody & DecisionsBody
    >();
    const open = await openThreadCalls(deps.db, threadId);
    const resolutions = (decisions ?? []).filter((d) => open.has(d.toolCallId));
    if (resolutions.length === 0) return c.text('no open call to resume', 409);

    deps.runner.start({
      threadId,
      providerId,
      modelId,
      permissionMode,
      resumeRunId: runId,
      resolutions,
    });
    return runResponse(threadId);
  });

  /**
   * Record decisions without running the model. Used when a decision closes a
   * call but must not resume the turn — a cancelled clarification, where the
   * user has taken the turn back and will send again themselves. The call still
   * has to be closed, or the next request's history carries an unpaired call.
   */
  app.post('/api/chat/:threadId/decisions', async (c) => {
    const threadId = c.req.param('threadId');
    const { decisions } = await c.req.json<DecisionsBody>();
    const open = await openThreadCalls(deps.db, threadId);
    const results = (decisions ?? [])
      .flatMap((decision) => {
        const call = open.get(decision.toolCallId);
        return call ? [resultFor(call, decision)] : [];
      })
      .filter((result): result is ToolResultMessage => result !== null);
    await settleThreadCalls(deps.db, threadId, results);
    return c.json({ settled: results.length });
  });

  // Stop a thread's in-flight generation. Aborts the agent loop server-side
  // (closing the client stream alone can't, since the run is decoupled for
  // resume); whatever was generated so far is persisted as the turn ends.
  app.post('/api/chat/:threadId/abort', (c) => {
    const aborted = abortThreadRun(c.req.param('threadId'));
    return c.json({ aborted });
  });

  // Force-compact a thread on demand (user-invoked /compact). Summarizes the
  // history into a checkpoint pair and persists it; the client then reloads to
  // show the divider. Needs a model (for the summary), so the client passes the
  // active provider/model like the chat endpoint.
  app.post('/api/chat/:threadId/compact', async (c) => {
    const threadId = c.req.param('threadId');
    const { providerId, modelId } = await c.req.json<{ providerId: string; modelId: string }>();
    const history = await threadHistory(deps.db, threadId);
    // Force-compact is aggressive on purpose: the automatic path keeps a quarter
    // of the window (so a short chat folds nothing), but the user asked to
    // compact now — keep only the recent floor and fold everything before it.
    const piModel = resolvePiModel(deps.db, providerId, modelId);
    const folded = await foldToCheckpoint({
      messages: history,
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
    await compactThread(deps.db, threadId, folded);
    log.info(
      `forced compaction folded ${history.length - folded.retainedTail.length} of ${history.length} messages`,
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
    return sse ? new Response(sse, { headers: PI_SSE_HEADERS }) : c.body(null, 204);
  });

  // serve() binds asynchronously; the real port arrives in the listening
  // callback (server.address() is null synchronously right after).
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({ port: info.port, token: deps.token });
    });
  });
}
