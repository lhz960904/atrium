import type { Message, TextContent, UserMessage } from '@shared/protocol';
import type { Complete } from './complete';

const TITLE_SYSTEM =
  "Write a concise title for a chat from the user's first message. " +
  "At most six words, in the message's own language. Output only the title — " +
  'no surrounding quotes, no trailing punctuation, no "Title:" prefix.';

function firstUserText(messages: Message[]): string {
  const user = messages.find((m): m is UserMessage => m.role === 'user');
  if (!user) return '';
  if (typeof user.content === 'string') return user.content;
  return user.content
    .flatMap((part) => (part.type === 'text' ? [(part as TextContent).text] : []))
    .join(' ')
    .trim();
}

export function cleanTitle(raw: string): string {
  const firstLine = raw.trim().split('\n', 1)[0].trim();
  // Models sometimes wrap the title in quotes or add a trailing period.
  return firstLine
    .replace(/^["'「『]+|["'」』。.]+$/g, '')
    .trim()
    .slice(0, 60);
}

/**
 * On a thread's first turn, summarize the opening user message into a short
 * title with the run's own model, hand it to the caller to persist, and let it
 * push a live notice. Fire-and-forget — it never blocks the reply, and any
 * failure leaves the fallback title set at thread creation in place.
 */
export function generateThreadTitle(opts: {
  messages: Message[];
  complete: Complete;
  onTitle: (title: string) => void;
}): void {
  // First turn only: no assistant message exists in the history yet.
  if (opts.messages.some((m) => m.role === 'assistant')) return;
  const seed = firstUserText(opts.messages);
  if (!seed) return;

  void (async () => {
    try {
      const title = cleanTitle(
        await opts.complete({ system: TITLE_SYSTEM, prompt: seed.slice(0, 2000) }),
      );
      if (title) opts.onTitle(title);
    } catch {
      // Best-effort: keep the creation-time fallback title on any failure.
    }
  })();
}
