import { serve } from '@hono/node-server';
import { UI_MESSAGE_STREAM_HEADERS, type UIMessage } from 'ai';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  compactionMiddleware,
  compactThread,
  metadataMiddleware,
  persistenceMiddleware,
  skillsMiddleware,
} from '../agent/middleware';
import { isImageModel, maxContextTokens } from '../agent/models/catalog';
import { runAgent } from '../agent/run';
import { runImageTurn } from '../agent/run-image';
import { LocalSandbox } from '../agent/sandbox';
import { getSkills } from '../agent/skills/registry';
import { getTools } from '../agent/tools';
import { skillPreserver } from '../agent/tools/builtins/skill';
import { todoPreserver } from '../agent/tools/builtins/todo';
import type { Db } from '../db';
import { createLogger } from '../log';
import { resolveModel } from '../providers/resolve';
import { loadThreadMessages, persistMessage, resolveToolOutput, upsertMessage } from './persist';
import { abortThreadRun, resumeThreadStream, startThreadStream } from './resumable';

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
const log = createLogger('chat');

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
    // the DB (the DB is the source of truth, not the client). An assistant
    // message arrives only when a client-side tool (ask_clarification) was just
    // answered and the chat auto-resumed: overwrite the stored call so history
    // carries the answer the model is about to continue from.
    if (message.role === 'user') persistMessage(deps.db, threadId, message);
    else if (message.role === 'assistant') upsertMessage(deps.db, threadId, message);
    const history = loadThreadMessages(deps.db, threadId);

    const abort = new AbortController();

    // use  run image gen if current model is image model
    const imageModel = isImageModel(modelId);
    log.info(`turn ${providerId}/${modelId} → ${imageModel ? 'image generation' : 'agent loop'}`);
    if (imageModel) {
      const imageStream = runImageTurn({
        db: deps.db,
        providerId,
        modelId,
        messages: history,
        abortSignal: abort.signal,
        onFinish: (m) =>
          upsertMessage(deps.db, threadId, { ...m, metadata: { createdAt: Date.now() } }),
      });
      const sse = await startThreadStream(threadId, imageStream, abort);
      return new Response(sse, { headers: UI_MESSAGE_STREAM_HEADERS });
    }

    const sandbox = new LocalSandbox(deps.workspaceRoot);
    const skills = getSkills();
    const agentStream = await runAgent({
      model: resolveModel(deps.db, providerId, modelId),
      messages: history,
      workspaceRoot: deps.workspaceRoot,
      threadId,
      db: deps.db,
      sandbox,
      abortSignal: abort.signal,
      tools: getTools({ sandbox, workspaceRoot: deps.workspaceRoot, db: deps.db, skills }),
      // skills must run after compaction: compaction may fold the original first
      // user message into a summary, and the skill index has to land on whatever
      // the post-compaction first user message is.
      middlewares: [
        metadataMiddleware(),
        compactionMiddleware({
          maxContextTokens,
          persist: persistMessage,
          preservers: [todoPreserver, skillPreserver],
        }),
        skillsMiddleware({ skills }),
        // Upsert, not insert-ignore: when a turn resumes after an
        // ask_clarification answer, the model extends the SAME assistant message
        // (reused id), and that continuation must overwrite the stored copy.
        persistenceMiddleware(upsertMessage),
      ],
    });
    const sse = await startThreadStream(threadId, agentStream, abort);
    return new Response(sse, { headers: UI_MESSAGE_STREAM_HEADERS });
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
    const compacted = await compactThread({
      db: deps.db,
      threadId,
      messages: loadThreadMessages(deps.db, threadId),
      model: resolveModel(deps.db, providerId, modelId),
      persist: persistMessage,
      preservers: [todoPreserver, skillPreserver],
    });
    return c.json({ compacted });
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
