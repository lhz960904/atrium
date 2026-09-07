import { serve } from '@hono/node-server';
import type { AtriumUIMessage } from '@shared/chat';
import type { PermissionMode } from '@shared/permissions';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Resolution } from '../agent/pi/approvals';
import { toolCallsById } from '../agent/pi/approvals';
import { foldToCheckpoint } from '../agent/pi/compaction';
import type { RunRow } from '../agent/pi/recorder';
import { createSummarizer } from '../agent/pi/summarize';
import { preserveActiveSkill } from '../agent/tools/builtins/skill';
import { preserveTodos } from '../agent/tools/builtins/todo';
import type { Db } from '../db';
import { createLogger } from '../log';
import { makeGetApiKey, piStreamFn, resolvePiModel } from '../providers/pi-model';
import { loadRunRows, loadThreadHistory, persistCheckpoint, resolveToolOutput } from './persist';
import { subscribePiEvents } from './pi-events';
import { abortThreadRun, isThreadRunning } from './resumable';
import type { Runner } from './runner';

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

// Client sends only the latest message; the server rebuilds history from the DB. The thread row always exists before
// the chat view can send (the home view creates it, then navigates), so
// threadId is a hard requirement — its absence is a bug, not a degraded mode.
type ChatBody = {
  threadId: string;
  providerId: string;
  modelId: string;
  message: AtriumUIMessage;
  permissionMode?: PermissionMode;
};

const log = createLogger('chat');

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

    // An assistant message arrives only when a client-side tool (a clarification
    // or an approval) was just answered and the chat auto-resumed: the run it
    // belongs to is continued, and the message is read for the user's decisions
    // rather than stored.
    const resumeRunId = message.role === 'assistant' ? message.id : undefined;
    const resolutions = resumeRunId
      ? resolutionsFor(message, loadRunRows(deps.db, resumeRunId))
      : [];

    deps.runner.start({
      threadId,
      providerId,
      modelId,
      permissionMode,
      userMessage: message.role === 'user' ? message : undefined,
      resumeRunId,
      resolutions,
    });
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
