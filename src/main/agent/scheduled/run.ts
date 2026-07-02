import type { SelectedModel } from '@shared/settings';
import { generateId, type UIMessage } from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db';
import type { ScheduledTask } from '../../db/schema';
import { messages } from '../../db/schema';
import { createLogger } from '../../log';

const log = createLogger('scheduled');

export type RunEndpoint = { port: number; token: string };

export type ScheduledRunResult = {
  status: 'ok' | 'error';
  error?: string;
  /** The assistant message this run produced in the bound thread, if any. */
  messageId?: string;
};

/**
 * Keep macOS App Nap / OS suspension from freezing a headless run mid-turn.
 * Electron is required lazily so the manager's import graph stays testable
 * outside an Electron context; a non-Electron context degrades to a no-op.
 */
function blockSuspension(): () => void {
  try {
    const { powerSaveBlocker } = require('electron') as typeof import('electron');
    const id = powerSaveBlocker.start('prevent-app-suspension');
    return () => {
      if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id);
    };
  } catch {
    return () => {};
  }
}

/** Id of the newest assistant message in a thread, or undefined. */
function latestAssistantId(db: Db, threadId: string): string | undefined {
  return db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), eq(messages.role, 'assistant')))
    .orderBy(desc(messages.createdAt))
    .limit(1)
    .get()?.id;
}

/**
 * Fire one scheduled task headlessly by driving the same localhost chat pipeline
 * the renderer uses: append the task prompt as a user turn to the task's bound
 * thread, then drain the response to completion. The run is decoupled from any
 * client (resumable.ts owns its lifetime), so draining here just tells us when
 * the turn finished — the messages are already persisted by the pipeline.
 *
 * The turn's own errors surface as an in-stream `error` chunk (onError), not an
 * HTTP status, so we scan the streamed bytes for one to report an accurate
 * ok/error — that's what drives the task's consecutive-failure auto-pause. The
 * produced assistant message is identified by diffing the thread's latest
 * assistant id across the run, so a failed run mis-attributes nothing.
 */
export async function runScheduledTask(
  deps: { db: Db; endpoint: RunEndpoint; defaultModel: () => SelectedModel | null },
  task: ScheduledTask,
): Promise<ScheduledRunResult> {
  if (!task.threadId) return { status: 'error', error: 'Scheduled task has no bound thread.' };
  const model =
    task.providerId && task.modelId
      ? { providerId: task.providerId, modelId: task.modelId }
      : deps.defaultModel();
  if (!model) {
    return { status: 'error', error: 'No model configured for this scheduled task.' };
  }

  const priorAssistant = latestAssistantId(deps.db, task.threadId);
  const message: UIMessage = {
    id: generateId(),
    role: 'user',
    parts: [{ type: 'text', text: task.prompt }],
  };

  const release = blockSuspension();
  try {
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${deps.endpoint.port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-atrium-token': deps.endpoint.token },
        body: JSON.stringify({
          threadId: task.threadId,
          providerId: model.providerId,
          modelId: model.modelId,
          message,
          permissionMode: task.permissionMode,
        }),
      });
    } catch (err) {
      log.error(`fetch failed for task ${task.id}`, err);
      return { status: 'error', error: String(err) };
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      return { status: 'error', error: `chat endpoint ${res.status}: ${body}`.trim() };
    }

    // Drain the SSE to EOF; the turn is done when the stream closes. Scan the
    // decoded bytes for an error chunk so a model/tool failure counts as a failed
    // run rather than a silent success.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let streamError: string | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (streamError) continue;
      const text = decoder.decode(value, { stream: true });
      const match = text.match(/"type":"error"[^}]*?"errorText":"((?:[^"\\]|\\.)*)"/);
      if (match) streamError = match[1] ? JSON.parse(`"${match[1]}"`) : 'The scheduled run failed.';
    }

    const after = latestAssistantId(deps.db, task.threadId);
    const messageId = after && after !== priorAssistant ? after : undefined;
    if (streamError) {
      log.error(`task ${task.id} run failed: ${streamError}`);
      return { status: 'error', error: streamError, messageId };
    }
    return { status: 'ok', messageId };
  } finally {
    release();
  }
}
