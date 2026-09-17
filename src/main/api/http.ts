import { serve } from '@hono/node-server';
import {
  InteractionConflict,
  InvalidInteractionDecision,
} from '@main/agent/runtime/pending-interactions';
import type { Runner } from '@main/agent/runtime/runner';
import type { AtriumUIMessage } from '@shared/chat';
import { decideInteractionSchema } from '@shared/interactions';
import type { PermissionMode } from '@shared/permissions';
import type { EventEnvelope } from '@shared/protocol';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

export type ChatEndpoint = { port: number; token: string };

const PI_SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

const DECISION_BODY_LIMIT = 64 * 1024;

/** Frame the run's envelopes as SSE; the event log itself carries no transport. */
function sseFrames(envelopes: ReadableStream<EventEnvelope>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return envelopes.pipeThrough(
    new TransformStream<EventEnvelope, Uint8Array>({
      transform(envelope, controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
      },
    }),
  );
}

/** The POST response is the just-started run's event stream from seq 0. */
function runResponse(runner: Runner, threadId: string): Response {
  const envelopes = runner.subscribe(threadId, -1);
  return envelopes
    ? new Response(sseFrames(envelopes), { headers: PI_SSE_HEADERS })
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

/**
 * Localhost HTTP server for AI streaming. Lives alongside electron-trpc: tRPC
 * handles CRUD, this handles the chat stream — a long-lived HTTP response the
 * renderer reads as SSE. Bound to 127.0.0.1 on a random free port; a per-launch
 * token gates /api/* so other local processes can't drive the user's model
 * credits.
 *
 * This layer only translates: it turns a request into a runner call and a run's
 * event log into an SSE body. It owns no state and reaches no database — every
 * decision about what a request means belongs to the runner.
 */
export function createChatApp(deps: { token: string; runner: Runner }): Hono {
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
    return runResponse(deps.runner, threadId);
  });

  /**
   * The user's decision for a call a running turn is waiting on. Accepting it
   * only wakes that call: whether the tool then runs, and what it returns,
   * arrives on the run's own stream. The body names the interaction, never the
   * tool or its arguments, and a decision never starts a run.
   */
  app.post(
    '/api/chat/:threadId/decisions',
    bodyLimit({
      maxSize: DECISION_BODY_LIMIT,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      const parsed = decideInteractionSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json({ error: 'invalid_decision' }, 400);
      try {
        const status = deps.runner.respond(c.req.param('threadId'), parsed.data);
        return c.json({ status }, 202);
      } catch (error) {
        if (error instanceof InteractionConflict) return c.json({ error: error.message }, 409);
        if (error instanceof InvalidInteractionDecision) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  );

  // Stop a thread's in-flight generation. Aborts the agent loop server-side
  // (closing the client stream alone can't: the run outlives its readers);
  // whatever was generated so far is persisted as the turn ends.
  app.post('/api/chat/:threadId/abort', (c) => {
    const aborted = deps.runner.abort(c.req.param('threadId'));
    return c.json({ aborted });
  });

  // Force-compact a thread on demand (user-invoked /compact). Needs a model for
  // the summary, so the client passes the active provider/model like the chat
  // endpoint; the client reloads afterwards to show the divider.
  app.post('/api/chat/:threadId/compact', async (c) => {
    const { providerId, modelId } = await c.req.json<{ providerId: string; modelId: string }>();
    const compacted = await deps.runner.compact({
      threadId: c.req.param('threadId'),
      providerId,
      modelId,
    });
    return c.json({ compacted });
  });

  // Reconnect endpoint: replay the thread's envelope log from `from`
  // (exclusive) and tail live. 204 when nothing is running — a finished run's
  // message is already in the DB the client seeds from, so replaying its log
  // would duplicate the content.
  app.get('/api/chat/:threadId/pi-events', (c) => {
    if (!deps.runner.isRunning(c.req.param('threadId'))) return c.body(null, 204);
    const raw = Number(c.req.query('from') ?? '-1');
    const envelopes = deps.runner.subscribe(
      c.req.param('threadId'),
      Number.isFinite(raw) ? raw : -1,
    );
    return envelopes
      ? new Response(sseFrames(envelopes), { headers: PI_SSE_HEADERS })
      : c.body(null, 204);
  });

  return app;
}

export function startHttpServer(deps: { token: string; runner: Runner }): Promise<ChatEndpoint> {
  const app = createChatApp(deps);
  // serve() binds asynchronously; the real port arrives in the listening
  // callback (server.address() is null synchronously right after).
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({ port: info.port, token: deps.token });
    });
  });
}
