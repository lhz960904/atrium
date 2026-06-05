import { tool } from 'ai';
import { z } from 'zod';

/**
 * Ask the user to resolve an ambiguity before continuing. This is a client-side
 * tool: it has no execute, so the model's call ends the turn with the questions
 * unanswered. The renderer shows them, the user answers, and the answers come
 * back as the tool result (addToolOutput) which auto-resumes the conversation.
 * Headless contexts can't surface this, so subagents are denied the tool.
 */
export const askClarificationTool = () =>
  tool({
    description: `Ask the user one to four clarifying questions when the request is genuinely ambiguous and a wrong guess would waste real work. Don't ask about things you can decide yourself or discover by looking — only ask when the answer materially changes what you build.

Each question needs a short header (≤12 chars, used as a tab label) and the question text. Pick the input type per question: 'single' (radio — pick one of the options), 'multi' (checkboxes — pick any number of the options), or 'text' (free input, no options). Provide options for single/multi; the user can always write their own answer beyond the listed options, so don't add a catch-all "other" option yourself. Keep it minimal — fewer, sharper questions beat a long form.`,
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            header: z.string().describe('Tab label, ≤12 chars (e.g. "Auth", "DB", "Style").'),
            question: z.string().describe('The full question to ask.'),
            inputType: z
              .enum(['single', 'multi', 'text'])
              .describe("'single' = one option, 'multi' = many, 'text' = free input."),
            options: z
              .array(
                z.object({
                  label: z.string(),
                  preview: z
                    .string()
                    .optional()
                    .describe('Optional code/mockup shown beside a single-select option.'),
                }),
              )
              .optional()
              .describe('Required for single/multi; omit for text.'),
            context: z.string().optional().describe('Optional one-line note under the question.'),
          }),
        )
        .min(1)
        .max(4)
        .describe('1–4 questions, shown as tabs when more than one.'),
    }),
  });
