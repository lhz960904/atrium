import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { LanguageModel, UIMessage } from 'ai';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AcpPermissionBroker, isAcpDecision } from '../agent/acp/permission-broker';
import { AcpSessionRegistry } from '../agent/acp/registry';
import { runExternalAgentTurn } from '../agent/acp/run-external-agent';
import { mcpManager } from '../agent/mcp/manager';
import { buildMcpTools } from '../agent/mcp/tool-adapter';
import { compactThread, generateThreadTitle } from '../agent/middleware';
import { isImageModel, modelPricing } from '../agent/models/catalog';
import { needsApprovalFor } from '../agent/permissions';
import { runAgent } from '../agent/run';
import { runImageTurn } from '../agent/run-image';
import { BackgroundShells, LocalSandbox } from '../agent/sandbox';
import { getSkills } from '../agent/skills/registry';
import { getTools, toAiSdkTools } from '../agent/tools';
import { skillPreserver } from '../agent/tools/builtins/skill';
import { todoPreserver } from '../agent/tools/builtins/todo';
import { getComputerUseHelper } from '../computer-use';
import type { Db } from '../db';
import { recordUsage } from '../db/usage';
import { createLogger } from '../log';
import { resolveAcpSpec } from '../providers/acp-spec';
import { getProviderManifest } from '../providers/manifest';
import { makeGetApiKey, piStreamFn, resolvePiModel } from '../providers/pi-model';
import { resolveModel, supportsImageToolResults } from '../providers/resolve';
import { getSettings } from '../settings/conf';
import {
  loadThreadAgentMessages,
  loadThreadMessages,
  persistMessage,
  persistRun,
  readAcpBinding,
  readAcpConfig,
  resolveThreadWorkspace,
  resolveToolOutput,
  setThreadTitle,
  upsertMessage,
  writeAcpBinding,
} from './persist';
import { drainChunkStream, subscribePiEvents } from './pi-events';
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
  message: UIMessage;
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
function resolveReviewerModel(
  db: Db,
  fallback: { providerId: string; modelId: string },
): LanguageModel | undefined {
  const configured = getSettings('permissions.reviewerModel');
  const picked = configured ?? fallback;
  try {
    const model = resolveModel(db, picked.providerId, picked.modelId);
    log.info(
      `reviewer = ${picked.providerId}/${picked.modelId}${configured ? '' : ' (inherited chat model)'}`,
    );
    return model;
  } catch (err) {
    log.info(`reviewer unresolved (${picked.providerId}/${picked.modelId}) → prompts: ${err}`);
    return undefined;
  }
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
  const acpSessions = new AcpSessionRegistry();
  // Parked ACP permission asks (the agent blocks mid-turn on each one); the
  // decision arrives on the acp-permission endpoint below, so the broker must
  // outlive any single request.
  const acpPermissions = new AcpPermissionBroker();

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
    else if (message.role === 'assistant') upsertMessage(deps.db, threadId, message);
    const history = loadThreadMessages(deps.db, threadId);

    // Resolve the thread's workspace per request: its project's directory, or
    // the projectless fallback. Drives the sandbox, tools, and ACP spec below.
    const workspaceRoot = resolveThreadWorkspace(deps.db, threadId, deps.projectlessRoot);

    const abort = new AbortController();

    // An external CLI agent (Claude Code / Codex / Gemini) handles the whole
    // turn over ACP, bypassing our own agent loop.
    if (getProviderManifest(providerId)?.kind === 'local-cli') {
      const spec = resolveAcpSpec(providerId, workspaceRoot, readAcpConfig(deps.db, providerId));
      if (!spec) return c.text(`unknown local-cli provider ${providerId}`, 400);
      log.info(`turn ${providerId} → external agent (acp)`);
      // Resume the agent's prior session for this thread when the bound provider
      // still matches, so a restart continues the same CLI conversation.
      const bound = readAcpBinding(deps.db, threadId);
      const resume = bound?.providerId === providerId ? bound.sessionId : undefined;
      const acpMode = permissionMode ?? DEFAULT_PERMISSION_MODE;
      const acpStream = runExternalAgentTurn({
        registry: acpSessions,
        threadId,
        spec,
        resume,
        messages: history,
        mode: acpMode,
        broker: acpPermissions,
        reviewerModel:
          acpMode === 'auto-review'
            ? resolveReviewerModel(deps.db, { providerId, modelId })
            : undefined,
        abortSignal: abort.signal,
        onSession: (sessionId) => writeAcpBinding(deps.db, threadId, providerId, sessionId),
        // The stream stamps createdAt + durationMs as message metadata; persist
        // the message as-is so the trace's "Worked for Xs" survives a reload.
        onFinish: (m) => upsertMessage(deps.db, threadId, m),
      });
      startThreadRun(
        threadId,
        (piLog) => drainChunkStream(piLog, { provider: providerId, model: modelId }, acpStream),
        abort,
      );
      return runResponse(threadId);
    }

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
      startThreadRun(
        threadId,
        (piLog) => drainChunkStream(piLog, { provider: providerId, model: modelId }, imageStream),
        abort,
      );
      return runResponse(threadId);
    }

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
    startThreadRun(
      threadId,
      (piLog) =>
        runAgent({
          runId,
          providerId,
          modelId,
          model: resolveModel(deps.db, providerId, modelId),
          piModel: resolvePiModel(deps.db, providerId, modelId),
          streamFn: piStreamFn,
          getApiKey: makeGetApiKey(deps.db),
          messages: loadThreadAgentMessages(deps.db, threadId),
          uiMessages: history,
          workspaceRoot,
          threadId,
          db: deps.db,
          sandbox,
          skills,
          permissionMode: mode,
          abortSignal: abort.signal,
          emit: piLog.append,
          persist: (rows, opts) => persistRun(deps.db, threadId, runId, rows, opts),
          recordUsage: (u) =>
            recordUsage(deps.db, { threadId, kind: 'chat', ...u }, modelPricing(u.modelId)),
          generateTitle: getSettings('general.autoGenerateTitle')
            ? (run) => generateThreadTitle(run, setThreadTitle)
            : undefined,
          onSettled: () => computerUse?.hideOverlay(),
          guardToolCall: ({ name, input }) =>
            needsApprovalFor(
              name,
              input,
              mode,
              workspaceRoot,
              getSettings('permissions.trustRules'),
            ),
          buildTools: (run) => {
            const toolCtx = {
              sandbox,
              workspaceRoot,
              run,
              skills,
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
                reviewerModel:
                  mode === 'auto-review'
                    ? resolveReviewerModel(deps.db, { providerId, modelId })
                    : undefined,
                abortSignal: abort.signal,
              },
            };
            const tools = getTools(toolCtx);
            return { tools, aiSdk: toAiSdkTools(tools, toolCtx) };
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

  // Deliver the user's decision to a parked ACP permission ask. The external
  // agent is blocked mid-turn on it, so this unblocks the live turn in place —
  // unlike native approvals, which end the turn and resume via a new /api/chat
  // POST. `ok: false` means the ask is gone (already settled, or the turn
  // ended); the client just drops its card.
  app.post('/api/chat/:threadId/acp-permission', async (c) => {
    const { requestId, decision } = await c.req.json<{ requestId: string; decision: unknown }>();
    if (!isAcpDecision(decision)) return c.text('invalid decision', 400);
    return c.json({ ok: acpPermissions.resolve(requestId, decision) });
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
          acpSessions.disposeAll();
        },
      });
    });
  });
}
