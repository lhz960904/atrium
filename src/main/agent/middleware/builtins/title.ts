import { generateText, type UIMessage } from 'ai';
import type { Db } from '../../../db';
import type { AgentMiddleware, RunContext } from '../types';

export type SetTitleFn = (db: Db, threadId: string, title: string) => void;

const TITLE_SYSTEM =
  "Write a concise title for a chat from the user's first message. " +
  "At most six words, in the message's own language. Output only the title — " +
  'no surrounding quotes, no trailing punctuation, no "Title:" prefix.';

function firstUserText(messages: UIMessage[]): string {
  const user = messages.find((m) => m.role === 'user');
  if (!user) return '';
  return user.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join(' ')
    .trim();
}

function cleanTitle(raw: string): string {
  const firstLine = raw.trim().split('\n', 1)[0].trim();
  // Models sometimes wrap the title in quotes or add a trailing period.
  return firstLine
    .replace(/^["'「『]+|["'」』。.]+$/g, '')
    .trim()
    .slice(0, 60);
}

async function generateTitle(ctx: RunContext, seed: string, setTitle: SetTitleFn): Promise<void> {
  try {
    const { text } = await generateText({
      model: ctx.model,
      system: TITLE_SYSTEM,
      prompt: seed.slice(0, 2000),
    });
    const title = cleanTitle(text);
    if (!title) return;
    setTitle(ctx.db, ctx.threadId, title);
    try {
      ctx.emit({ type: 'data-title', data: { title }, transient: true });
    } catch {
      // Stream already closed (fast turn / abort) — the persisted title stands.
    }
  } catch {
    // Best-effort: keep the creation-time fallback title on any failure.
  }
}

/**
 * On a thread's first turn, summarize the opening user message into a short
 * title with the run's own model, persist it, and push a transient title part
 * so an open chat updates live. Fire-and-forget — it never blocks the reply,
 * and any failure leaves the fallback title set at thread creation in place.
 */
export function titleMiddleware(setTitle: SetTitleFn): AgentMiddleware {
  return {
    name: 'title',
    beforeRun(ctx) {
      // First turn only: no assistant message exists in the history yet.
      if (ctx.request.messages.some((m) => m.role === 'assistant')) return;
      const seed = firstUserText(ctx.request.messages);
      if (!seed) return;
      void generateTitle(ctx, seed, setTitle);
    },
  };
}
