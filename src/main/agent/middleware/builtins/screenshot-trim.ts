import type { ModelMessage } from 'ai';
import { persistToolImage } from '../../mcp/spill';
import type { AgentMiddleware, RunContext, StepInfo, StepOverride } from '../types';

const KEEP_RECENT_IMAGES = 2;
const SPILL_CACHE_KEY = 'screenshot-trim.spilled';

type ContentPart = { type?: string; mediaType?: string; data?: string; text?: string };
type ToolOutput = { type?: string; value?: ContentPart[] };

function partIsImage(part: ContentPart): boolean {
  return (
    part.type === 'image-data' ||
    part.type === 'image' ||
    part.type === 'media' ||
    (typeof part.mediaType === 'string' && part.mediaType.startsWith('image/'))
  );
}

/** The tool-result output's content parts, when it carries at least one image. */
function imageOutputValue(part: unknown): ContentPart[] | null {
  const output = (part as { output?: ToolOutput }).output;
  if (output?.type !== 'content' || !Array.isArray(output.value)) return null;
  return output.value.some(partIsImage) ? output.value : null;
}

function trimNote(paths: string[]): ContentPart {
  const text =
    paths.length > 0
      ? `[Screenshot from an earlier step was omitted to save context. It is saved at ${paths.join(', ')} — call view_image with that path to see it again if you need it.]`
      : '[Screenshot from an earlier step was omitted to save context.]';
  return { type: 'text', text };
}

/**
 * Every computer-use / browser step returns a full screenshot; across a long
 * turn they stack up and dominate the model's context (and cost). Keep the last
 * N tool-result screenshots; for older ones, spill each image to the workspace
 * media dir and replace it with a note carrying the path, so the model can call
 * view_image to re-read one on demand. State text (e.g. the accessibility tree)
 * is untouched, and only image parts are swapped for the note — never whole
 * messages — so compaction's index-based checkpointing is unaffected. Spilled
 * paths are cached per tool call so re-processing a later step doesn't re-write
 * the same file. Runs before compaction so its token accounting reflects it.
 */
export function screenshotTrimMiddleware(keepRecent = KEEP_RECENT_IMAGES): AgentMiddleware {
  return {
    name: 'screenshot-trim',
    async beforeStep(ctx: RunContext, { messages }: StepInfo): Promise<StepOverride | undefined> {
      const located: Array<{ mi: number; pi: number; toolCallId: string }> = [];
      messages.forEach((m, mi) => {
        if (m.role !== 'tool' || !Array.isArray(m.content)) return;
        m.content.forEach((part, pi) => {
          if (imageOutputValue(part)) {
            const toolCallId = (part as { toolCallId?: string }).toolCallId ?? `${mi}:${pi}`;
            located.push({ mi, pi, toolCallId });
          }
        });
      });
      if (located.length <= keepRecent) return undefined;

      let cache = ctx.scratch.get(SPILL_CACHE_KEY) as Map<string, string> | undefined;
      if (!cache) {
        cache = new Map<string, string>();
        ctx.scratch.set(SPILL_CACHE_KEY, cache);
      }

      // Build the replacement content for each stale tool result: keep its text,
      // spill each image to disk (once, cached), and add a single view_image note.
      const rewritten = new Map<string, ContentPart[]>();
      for (const { mi, pi, toolCallId } of located.slice(0, located.length - keepRecent)) {
        const value = imageOutputValue((messages[mi].content as ContentPart[])[pi]);
        if (!value) continue;
        const kept: ContentPart[] = [];
        const paths: string[] = [];
        let imageIndex = 0;
        for (const part of value) {
          if (!partIsImage(part)) {
            kept.push(part);
            continue;
          }
          const key = `${toolCallId}#${imageIndex++}`;
          let path = cache.get(key);
          if (!path && typeof part.data === 'string' && typeof part.mediaType === 'string') {
            try {
              path = await persistToolImage(part.data, part.mediaType, ctx.workspaceRoot);
              cache.set(key, path);
            } catch {
              path = undefined;
            }
          }
          if (path) paths.push(path);
        }
        rewritten.set(`${mi}:${pi}`, [...kept, trimNote(paths)]);
      }

      const next = messages.map((m, mi) => {
        if (m.role !== 'tool' || !Array.isArray(m.content)) return m;
        let changed = false;
        const content = m.content.map((part, pi) => {
          const value = rewritten.get(`${mi}:${pi}`);
          if (!value) return part;
          changed = true;
          const output = (part as { output: ToolOutput }).output;
          return { ...(part as object), output: { ...output, value } };
        });
        return changed ? ({ ...m, content } as ModelMessage) : m;
      });
      return { messages: next };
    },
  };
}
