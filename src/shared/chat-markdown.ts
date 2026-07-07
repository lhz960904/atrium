import type { UIMessage } from 'ai';
import { normalizedParts } from './message-parts';

/**
 * Render a conversation as clean, reader-facing markdown — the copy/export
 * format. User text and assistant prose come through verbatim; a run of tool
 * activity collapses to a one-line placeholder; images and attachments become
 * a filename note. Reasoning, tool outputs, data parts, and compaction
 * checkpoints are internal bookkeeping and stay out.
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
    turns.push(`**${msg.role === 'user' ? opts.labels.user : opts.labels.assistant}**\n\n${body}`);
  }
  return `# ${opts.title}\n\n${turns.join('\n\n')}\n`;
}

/** The persisted summary + ack pair a compaction fold leaves behind. */
function isCompactionCheckpoint(msg: UIMessage): boolean {
  const kind = (msg.metadata as { kind?: string } | undefined)?.kind;
  return kind === 'compaction' || kind === 'compaction-ack';
}

function renderBody(msg: UIMessage, labels: ChatMarkdownLabels): string {
  const blocks: string[] = [];
  let toolRun = 0;
  const flushTools = (): void => {
    if (toolRun > 0) {
      blocks.push(`> ${labels.tools(toolRun)}`);
      toolRun = 0;
    }
  };
  for (const part of normalizedParts(msg)) {
    switch (part.kind) {
      case 'text': {
        const text = part.text.trim();
        if (text) {
          flushTools();
          blocks.push(text);
        }
        break;
      }
      case 'tool-call':
        toolRun++;
        break;
      case 'file':
        flushTools();
        blocks.push(`> ${labels.image(part.filename)}`);
        break;
      default:
        // reasoning / tool-result / source / data: not part of the clean view.
        break;
    }
  }
  flushTools();
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
