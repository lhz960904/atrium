import type { ToolCtx } from '../context';
import { defineTool, StringEnum, Type } from '../define';

/**
 * Ask the user to resolve an ambiguity before continuing. The call waits inside
 * the running turn until the user answers, and the answer is its result.
 * Headless contexts can't surface this, so subagents are denied the tool.
 */
export const askClarificationTool = (ask?: ToolCtx['ask']) =>
  defineTool({
    name: 'ask_clarification',
    label: 'Ask the user',
    description: `Ask the user one to four clarifying questions when the request is genuinely ambiguous and a wrong guess would waste real work. Don't ask about things you can decide yourself or discover by looking — only ask when the answer materially changes what you build.

Each question needs a short header (≤12 chars, used as a tab label) and the question text. Pick the input type per question: 'single' (radio — pick one of the options), 'multi' (checkboxes — pick any number of the options), or 'text' (free input, no options). Provide options for single/multi; the user can always write their own answer beyond the listed options, so don't add a catch-all "other" option yourself. Keep it minimal — fewer, sharper questions beat a long form.`,
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          header: Type.String({
            description: 'Tab label, ≤12 chars (e.g. "Auth", "DB", "Style").',
          }),
          question: Type.String({ description: 'The full question to ask.' }),
          inputType: StringEnum(['single', 'multi', 'text'], {
            description: "'single' = one option, 'multi' = many, 'text' = free input.",
          }),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String(),
                preview: Type.Optional(
                  Type.String({
                    description: 'Optional code/mockup shown beside a single-select option.',
                  }),
                ),
              }),
              { description: 'Required for single/multi; omit for text.' },
            ),
          ),
          context: Type.Optional(
            Type.String({ description: 'Optional one-line note under the question.' }),
          ),
        }),
        {
          minItems: 1,
          maxItems: 4,
          description: '1–4 questions, shown as tabs when more than one.',
        },
      ),
    }),
    execute: async (toolCallId, args, signal) => {
      if (!ask) throw new Error('User interaction is unavailable in this context.');
      return ask(
        { type: 'toolCall', id: toolCallId, name: 'ask_clarification', arguments: args },
        signal,
      );
    },
  });
