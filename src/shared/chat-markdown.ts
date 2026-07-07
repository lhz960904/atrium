import type { UIMessage } from 'ai';
import { normalizedParts } from './message-parts';

/**
 * Render a conversation as clean, reader-facing markdown — the copy/export
 * format. Mirrors the chat view's presentation: everything up to a message's
 * last tool call is collapsed working process (one placeholder line carrying
 * the tool count), and only the prose after it — the final answer — comes
 * through verbatim. Images and attachments become a filename note. Reasoning,
 * tool outputs, data parts, and compaction checkpoints are internal
 * bookkeeping and stay out.
 */

export type ChatMarkdownLabels = {
  user: string;
  assistant: string;
  /** Placeholder for a run of consecutive tool calls, e.g. "使用了 3 个工具". */
  tools: (count: number) => string;
  /** Placeholder for an inline image/attachment note. */
  image: (filename?: string) => string;
};

export function renderChatMarkdown(opts: {
  title: string;
  messages: UIMessage[];
  labels: ChatMarkdownLabels;
}): string {
  const turns: string[] = [];
  for (const msg of opts.messages) {
    if (msg.role === 'system' || isCompactionCheckpoint(msg)) continue;
    const body = renderBody(msg, opts.labels);
    if (!body) continue;
    turns.push(`## ${msg.role === 'user' ? opts.labels.user : opts.labels.assistant}\n\n${body}`);
  }
  return `# ${opts.title}\n\n${turns.join('\n\n')}\n`;
}

/** The persisted summary + ack pair a compaction fold leaves behind. */
function isCompactionCheckpoint(msg: UIMessage): boolean {
  const kind = (msg.metadata as { kind?: string } | undefined)?.kind;
  return kind === 'compaction' || kind === 'compaction-ack';
}

function renderBody(msg: UIMessage, labels: ChatMarkdownLabels): string {
  const parts = normalizedParts(msg);
  // Narration interleaved between tool calls ("let me check…") is working
  // process, not the answer — exporting it turn-by-turn reads as noise. Fold
  // it into the single tool-count line, exactly like the chat view's collapsed
  // "Worked for …" block, and keep only what follows the last tool call.
  let lastCall = -1;
  let toolCount = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind === 'tool-call') {
      lastCall = i;
      toolCount++;
    }
  }
  const blocks: string[] = [];
  if (toolCount > 0) blocks.push(`> ${labels.tools(toolCount)}`);
  for (const part of parts.slice(lastCall + 1)) {
    if (part.kind === 'text') {
      const text = part.text.trim();
      if (text) blocks.push(text);
    } else if (part.kind === 'file') {
      blocks.push(`> ${labels.image(part.filename)}`);
    }
    // reasoning / tool-result / source / data: not part of the clean view.
  }
  return blocks.join('\n\n');
}

/** Thread title → safe cross-platform filename (no extension). */
export function exportFilename(title: string): string {
  const safe = title
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return safe || 'conversation';
}
