import { serve } from '@hono/node-server';
import type { UIMessage } from 'ai';
import { Hono } from 'hono';
import { runAgent } from '../agent/run';
import type { Db } from '../db';

export type ChatEndpoint = { port: number; token: string };

type ChatBody = {
  threadId?: string;
  providerId: string;
  modelId: string;
  messages: UIMessage[];
};

/**
 * Localhost HTTP server for AI streaming. Lives alongside electron-trpc:
 * tRPC handles CRUD, this handles the chat stream (AI SDK's happy path is
 * an HTTP Response that useChat consumes). Bound to 127.0.0.1 on a random
 * free port; a per-launch token gates /api/* so other local processes
 * can't drive the user's model credits.
 */
export function startHttpServer(deps: { db: Db; token: string }): ChatEndpoint {
  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    if (c.req.header('x-atrium-token') !== deps.token) return c.text('unauthorized', 401);
    return next();
  });

  app.post('/api/chat', async (c) => {
    const { providerId, modelId, messages } = await c.req.json<ChatBody>();
    return runAgent({
      db: deps.db,
      providerId,
      modelId,
      messages,
      abortSignal: c.req.raw.signal,
    });
  });

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  const port = (server.address() as { port: number }).port;
  return { port, token: deps.token };
}
