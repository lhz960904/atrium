import {
  type NormalizedPart,
  type NormalizedToolOutput,
  normalizedParts,
  stringifyUnknown,
} from '@shared/message-parts';
import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { SUMMARY_SYSTEM, summaryPrompt } from '../pi/summarize';

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

/**
 * Inline images (base64) must never reach the summarizer — they'd bloat the
 * prompt with megabytes of undecodable text, and the summary model may lack
 * vision anyway. Normalization already keeps them out of `text`; render just
 * a count so the summary knows something visual happened.
 */
function renderToolOutput(output: NormalizedToolOutput): string {
  const imageNote = output.images.length > 0 ? `[${output.images.length} image(s) omitted]` : '';
  return [output.text, imageNote].filter(Boolean).join('\n');
}

function renderPart(part: NormalizedPart): string {
  switch (part.kind) {
    case 'text':
    case 'reasoning':
      return part.text;
    case 'tool-call':
      return `[tool ${part.name}] ${stringifyUnknown(part.input)}`;
    case 'tool-result':
      return `[tool result ${part.name}] ${renderToolOutput(part.output)}`;
    default:
      return `[${part.kind}]`;
  }
}

function renderMessage(msg: ModelMessage): string {
  return `## ${msg.role}\n${normalizedParts(msg).map(renderPart).join('\n')}`;
}

export function renderTranscript(messages: ModelMessage[]): string {
  return messages.map(renderMessage).join('\n\n');
}

export type SummarizeOptions = { abortSignal?: AbortSignal; maxOutputTokens?: number };

/**
 * The summarizer itself, over an already-flattened transcript. Each message
 * family renders its own transcript and shares this call.
 */
export async function summarizeTranscript(
  transcript: string,
  model: LanguageModel,
  opts: SummarizeOptions = {},
): Promise<string> {
  const { text } = await generateText({
    model,
    system: SUMMARY_SYSTEM,
    prompt: summaryPrompt(transcript),
    abortSignal: opts.abortSignal,
    maxOutputTokens: opts.maxOutputTokens,
  });
  return text.trim();
}

export async function summarize(
  messages: ModelMessage[],
  model: LanguageModel,
  opts: SummarizeOptions = {},
): Promise<string> {
  return summarizeTranscript(renderTranscript(messages), model, opts);
}
