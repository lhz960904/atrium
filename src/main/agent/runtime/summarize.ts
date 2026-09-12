import { type Complete, type CompleteDeps, createCompleter } from './complete';

/**
 * The compaction summarizer. The fold is handed over as a flat transcript
 * rather than as messages — flattening sidesteps cross-provider
 * role-alternation and dangling tool-call pitfalls, and a summary is prose
 * anyway. Structure borrowed from Claude Code's compact prompt.
 */

export const SUMMARY_SYSTEM =
  'You compress a coding-agent conversation so work can continue in a fresh ' +
  'context window. Capture every detail needed to resume without re-reading the ' +
  'original. Do not call tools. Write the summary in the same language as the ' +
  'conversation. Preserve code snippets, file paths, and identifiers verbatim.';

export const SUMMARY_INSTRUCTION = `Summarize the conversation below using exactly these sections:

1. User intent — every original user request and goal, in order, nothing dropped.
2. Key technical concepts, frameworks, and decisions.
3. Files touched — paths plus the relevant code snippets.
4. Errors hit and how they were fixed, including user feedback.
5. Problems solved and problems still open.
6. Pending tasks the user explicitly asked for.
7. Current work in progress (most recent first).
8. Next step, aligned with the user's most recent request.`;

export const summaryPrompt = (transcript: string): string =>
  `${SUMMARY_INSTRUCTION}\n\n<conversation>\n${transcript}\n</conversation>`;

export type Summarize = (transcript: string, signal?: AbortSignal) => Promise<string>;

export function summarizerFrom(complete: Complete): Summarize {
  return (transcript, signal) =>
    complete({ system: SUMMARY_SYSTEM, prompt: summaryPrompt(transcript), signal });
}

export function createSummarizer(deps: CompleteDeps): Summarize {
  return summarizerFrom(createCompleter(deps));
}
