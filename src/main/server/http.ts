import { serve } from '@hono/node-server';
import { UI_MESSAGE_STREAM_HEADERS, type UIMessage } from 'ai';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { runAgent } from '../agent/run';
import { LocalSandbox } from '../agent/sandbox';
import { getTools } from '../agent/tools';
import type { Db } from '../db';
import { resolveModel } from '../providers/resolve';
import { loadThreadMessages, persistMessage } from './persist';
import { resumeThreadStream, startThreadStream } from './resumable';

export type ChatEndpoint = { port: number; token: string };

// Client sends only the latest message (AI SDK persistence best practice);
// the server rebuilds history from the DB. The thread row always exists before
// the chat view can send (the home view creates it, then navigates), so
// threadId is a hard requirement — its absence is a bug, not a degraded mode.
type ChatBody = {
  threadId: string;
  providerId: string;
  modelId: string;
  message: UIMessage;
};

/**
 * Localhost HTTP server for AI streaming. Lives alongside electron-trpc:
 * tRPC handles CRUD, this handles the chat stream (AI SDK's happy path is
 * an HTTP Response that useChat consumes). Bound to 127.0.0.1 on a random
 * free port; a per-launch token gates /api/* so other local processes
 * can't drive the user's model credits.
 */
export function startHttpServer(deps: {
  db: Db;
  token: string;
  workspaceRoot: string;
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
    const { threadId, providerId, modelId, message } = await c.req.json<ChatBody>();
    if (!threadId) return c.text('threadId required', 400);

    // Persist the just-sent user message, then rebuild the full history from
    // the DB (the DB is the source of truth, not the client).
    if (message.role === 'user') persistMessage(deps.db, threadId, message);
    const history = loadThreadMessages(deps.db, threadId);

    const sandbox = new LocalSandbox(deps.workspaceRoot);
    // The resumable stream's producer drives the agent to completion on its
    // own, independent of this request — so navigating away or reloading leaves
    // the run streaming in main, reattachable via the reconnect endpoint.
    const agentStream = await runAgent({
      model: resolveModel(deps.db, providerId, modelId),
      messages: history,
      workspaceRoot: deps.workspaceRoot,
      tools: getTools({ sandbox, workspaceRoot: deps.workspaceRoot }),
      onFinish: (assistant) => persistMessage(deps.db, threadId, assistant),
    });
    const sse = await startThreadStream(threadId, agentStream);
    return new Response(sse, { headers: UI_MESSAGE_STREAM_HEADERS });
  });

  // Reconnect endpoint. If a run is still streaming (or just finished and still
  // buffered) for this thread, hand back its replay-from-start + live-tail
  // stream so a remounted client (thread switch, window reload) rejoins it.
  // 204 when nothing is buffered — the client then shows its loaded messages.
  app.get('/api/chat/:threadId/stream', async (c) => {
    const sse = await resumeThreadStream(c.req.param('threadId'));
    return sse ? new Response(sse, { headers: UI_MESSAGE_STREAM_HEADERS }) : c.body(null, 204);
  });

  // serve() binds asynchronously; the real port arrives in the listening
  // callback (server.address() is null synchronously right after).
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({ port: info.port, token: deps.token });
    });
  });
}
