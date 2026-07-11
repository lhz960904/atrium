import type { ModelMessage } from 'ai';
import type { AgentMiddleware, RunContext, StepInfo, StepOverride } from '../types';

const KEEP_RECENT_IMAGES = 2;
const TRIMMED_NOTE = '[Screenshot from an earlier step omitted to save context.]';

type ContentPart = { type?: string; mediaType?: string };
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

/**
 * Every computer-use / browser step returns a full screenshot; across a long
 * turn they stack up and dominate the model's context (and cost). The model only
 * needs the most recent ones to judge the current state, so keep the last N
 * tool-result screenshots and drop the images from older ones — the state text
 * (the accessibility tree) stays, so nothing meaningful is lost. Only the image
 * parts are removed, never whole messages, so compaction's index-based
 * checkpointing is unaffected; it runs after this so its token accounting
 * already reflects the trim.
 */
export function screenshotTrimMiddleware(keepRecent = KEEP_RECENT_IMAGES): AgentMiddleware {
  return {
    name: 'screenshot-trim',
    beforeStep(_ctx: RunContext, { messages }: StepInfo): StepOverride | undefined {
      const located: Array<{ mi: number; pi: number }> = [];
      messages.forEach((m, mi) => {
        if (m.role !== 'tool' || !Array.isArray(m.content)) return;
        m.content.forEach((part, pi) => {
          if (imageOutputValue(part)) located.push({ mi, pi });
        });
      });
      if (located.length <= keepRecent) return undefined;

      const trim = new Set(
        located.slice(0, located.length - keepRecent).map(({ mi, pi }) => `${mi}:${pi}`),
      );

      const next = messages.map((m, mi) => {
        if (m.role !== 'tool' || !Array.isArray(m.content)) return m;
        let changed = false;
        const content = m.content.map((part, pi) => {
          const value = trim.has(`${mi}:${pi}`) ? imageOutputValue(part) : null;
          if (!value) return part;
          changed = true;
          const kept = value.filter((v) => !partIsImage(v));
          const withText = kept.some((v) => v.type === 'text')
            ? kept
            : [{ type: 'text', text: TRIMMED_NOTE }];
          const output = (part as { output: ToolOutput }).output;
          return { ...(part as object), output: { ...output, value: withText } };
        });
        return changed ? ({ ...m, content } as ModelMessage) : m;
      });
      return { messages: next };
    },
  };
}
