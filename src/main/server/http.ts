import { serve } from '@hono/node-server';
import type { UIMessage } from 'ai';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { runAgent } from '../agent/run';
import type { Db } from '../db';
import { resolveModel } from '../providers/resolve';
import { loadThreadMessages, persistMessage } from './persist';

export type ChatEndpoint = { port: number; token: string };

// Client sends only the latest message (AI SDK persistence best practice);
// the server rebuilds history from the DB.
type ChatBody = {
  threadId?: string;
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
export function startHttpServer(deps: { db: Db; token: string }): Promise<ChatEndpoint> {
  const app = new Hono();

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

    // Persist the just-sent user message, then rebuild the full history from
    // the DB (the DB is the source of truth, not the client).
    if (threadId && message.role === 'user') persistMessage(deps.db, threadId, message);
    const history = threadId ? loadThreadMessages(deps.db, threadId) : [message];

    return runAgent({
      model: resolveModel(deps.db, providerId, modelId),
      messages: history,
      abortSignal: c.req.raw.signal,
      onFinish: (assistant) => {
        if (threadId) persistMessage(deps.db, threadId, assistant);
      },
    });
  });

  // serve() binds asynchronously; the real port arrives in the listening
  // callback (server.address() is null synchronously right after).
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({ port: info.port, token: deps.token });
    });
  });
}
