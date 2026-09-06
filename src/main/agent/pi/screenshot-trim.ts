import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent, ToolResultMessage } from '@shared/protocol';
import { persistToolImage } from '../mcp/spill';
import type { ContextTransform } from './context';

const KEEP_RECENT_IMAGES = 2;

type ResultContent = (TextContent | ImageContent)[];

const isImage = (part: TextContent | ImageContent): part is ImageContent => part.type === 'image';

const carriesImage = (message: AgentMessage): boolean =>
  message.role === 'toolResult' && (message.content as ResultContent).some(isImage);

function trimNote(paths: string[]): TextContent {
  return {
    type: 'text',
    text:
      paths.length > 0
        ? `[Screenshot from an earlier step was omitted to save context. It is saved at ${paths.join(', ')} — call view_image with that path to see it again if you need it.]`
        : '[Screenshot from an earlier step was omitted to save context.]',
  };
}

/**
 * Every computer-use / browser step returns a full screenshot; across a long
 * turn they stack up and dominate the model's context (and cost). Keep the last
 * N tool-result screenshots; for older ones, spill each image to the workspace
 * media dir and replace it with a note carrying the path, so the model can call
 * view_image to re-read one on demand. State text (e.g. the accessibility tree)
 * is untouched, and only image parts are swapped for the note — never whole
 * messages — so compaction's index-based checkpointing is unaffected. The card's
 * `details` keeps the image either way: this rewrites the model's view only.
 * Spilled paths are cached per tool call so a later request doesn't re-write the
 * same file.
 */
export function screenshotTrim(
  workspaceRoot: string,
  keepRecent = KEEP_RECENT_IMAGES,
): ContextTransform {
  const spilled = new Map<string, string>();

  return async (messages) => {
    const carriers = messages.flatMap((m, i) => (carriesImage(m) ? [i] : []));
    if (carriers.length <= keepRecent) return messages;

    const trimmed = new Map<number, ResultContent>();
    for (const index of carriers.slice(0, carriers.length - keepRecent)) {
      const message = messages[index] as ToolResultMessage;
      const kept: ResultContent = [];
      const paths: string[] = [];
      let imageIndex = 0;
      for (const part of message.content as ResultContent) {
        if (!isImage(part)) {
          kept.push(part);
          continue;
        }
        const key = `${message.toolCallId}#${imageIndex++}`;
        let path = spilled.get(key);
        if (!path) {
          try {
            path = await persistToolImage(part.data, part.mimeType, workspaceRoot);
            spilled.set(key, path);
          } catch {
            path = undefined;
          }
        }
        if (path) paths.push(path);
      }
      trimmed.set(index, [...kept, trimNote(paths)]);
    }

    return messages.map((message, index) => {
      const content = trimmed.get(index);
      return content ? ({ ...message, content } as AgentMessage) : message;
    });
  };
}
