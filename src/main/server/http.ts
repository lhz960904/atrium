import { serve } from '@hono/node-server';
import { createUIMessageStreamResponse, type UIMessage } from 'ai';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { runAgent } from '../agent/run';
import { LocalSandbox } from '../agent/sandbox';
import { getTools } from '../agent/tools';
import type { Db } from '../db';
import { resolveModel } from '../providers/resolve';
import { loadThreadMessages, persistMessage } from './persist';
import { RunRegistry } from './run-registry';

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
  const registry = new RunRegistry();

  // Renderer is a different origin (localhost:5173 in dev, file:// in prod);
  // CORS must run before auth so the credential-less preflight isn't 401'd.
  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'x-atrium-token'],
      allowMethods: ['POST', 'OPTIONS'],
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
    // The registry owns the run's lifetime and abort signal — not the request
    // signal — so navigating away (which drops this connection) leaves the run
    // streaming in main, reattachable via the reconnect endpoint.
    const stream = registry.start(threadId, (signal) =>
      runAgent({
        model: resolveModel(deps.db, providerId, modelId),
        messages: history,
        workspaceRoot: deps.workspaceRoot,
        tools: getTools({ sandbox, workspaceRoot: deps.workspaceRoot }),
        abortSignal: signal,
        onFinish: (assistant) => persistMessage(deps.db, threadId, assistant),
      }),
    );
    return createUIMessageStreamResponse({ stream });
  });

  // serve() binds asynchronously; the real port arrives in the listening
  // callback (server.address() is null synchronously right after).
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({ port: info.port, token: deps.token });
    });
  });
}
