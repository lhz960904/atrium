import { generateText, type LanguageModel, type ModelMessage } from 'ai';

/**
 * Summarize a folded slice of conversation into a structured digest that
 * survives a compaction boundary. The fold is rendered to a plain-text
 * transcript and handed to the model as a single prompt — flattening sidesteps
 * cross-provider role-alternation and dangling tool_use pitfalls, and a summary
 * is prose anyway. Structure borrowed from Claude Code's compact prompt.
 *
 * Callers pass ModelMessages: the within-turn path already has them; the
 * cross-turn path converts its UIMessages with convertToModelMessages first.
 */

const SUMMARY_SYSTEM =
  'You compress a coding-agent conversation so work can continue in a fresh ' +
  'context window. Capture every detail needed to resume without re-reading the ' +
  'original. Do not call tools. Write the summary in the same language as the ' +
  'conversation. Preserve code snippets, file paths, and identifiers verbatim.';

const SUMMARY_INSTRUCTION = `Summarize the conversation below using exactly these sections:

1. User intent — every original user request and goal, in order, nothing dropped.
2. Key technical concepts, frameworks, and decisions.
3. Files touched — paths plus the relevant code snippets.
4. Errors hit and how they were fixed, including user feedback.
5. Problems solved and problems still open.
6. Pending tasks the user explicitly asked for.
7. Current work in progress (most recent first).
8. Next step, aligned with the user's most recent request.`;

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Any content part a ModelMessage can carry — derived from the SDK, not hand-rolled. */
type ContentPart = Exclude<ModelMessage['content'], string>[number];

function renderPart(part: ContentPart): string {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return part.text;
    case 'tool-call':
      return `[tool ${part.toolName}] ${stringify(part.input)}`;
    case 'tool-result':
      return `[tool result ${part.toolName}] ${stringify(part.output)}`;
    default:
      return `[${part.type}]`;
  }
}

function renderMessage(msg: ModelMessage): string {
  const { content } = msg;
  const body =
    typeof content === 'string' ? content : (content as ContentPart[]).map(renderPart).join('\n');
  return `## ${msg.role}\n${body}`;
}

export function renderTranscript(messages: ModelMessage[]): string {
  return messages.map(renderMessage).join('\n\n');
}

export type SummarizeOptions = { abortSignal?: AbortSignal; maxOutputTokens?: number };

export async function summarize(
  messages: ModelMessage[],
  model: LanguageModel,
  opts: SummarizeOptions = {},
): Promise<string> {
  const { text } = await generateText({
    model,
    system: SUMMARY_SYSTEM,
    prompt: `${SUMMARY_INSTRUCTION}\n\n<conversation>\n${renderTranscript(messages)}\n</conversation>`,
    abortSignal: opts.abortSignal,
    maxOutputTokens: opts.maxOutputTokens,
  });
  return text.trim();
}
