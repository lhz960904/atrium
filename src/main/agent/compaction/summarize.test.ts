import { expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { renderTranscript, summarize } from './summarize';

function summaryModel(text: string, capture?: (o: LanguageModelV3CallOptions) => void) {
  return new MockLanguageModelV3({
    doGenerate: async (opts) => {
      capture?.(opts);
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

const fold: ModelMessage[] = [
  { role: 'user', content: 'fix the bug in parser.ts' },
  {
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: '1', toolName: 'read', input: { path: 'parser.ts' } },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: '1',
        toolName: 'read',
        output: { type: 'text', value: 'code' },
      },
    ],
  },
];

test('renderTranscript labels roles and renders tool parts', () => {
  const out = renderTranscript(fold);
  expect(out).toContain('## user\nfix the bug in parser.ts');
  expect(out).toContain('[tool read] {"path":"parser.ts"}');
  expect(out).toContain('[tool result read]');
});

test('summarize feeds the structured instruction and the transcript to the model', async () => {
  let opts: LanguageModelV3CallOptions | undefined;
  const model = summaryModel('done', (o) => {
    opts = o;
  });
  await summarize(fold, model);
  const sent = JSON.stringify(opts?.prompt);
  expect(sent).toContain('User intent');
  expect(sent).toContain('fix the bug in parser.ts');
});

test('summarize trims surrounding whitespace', async () => {
  const model = summaryModel('  plain summary  ');
  expect(await summarize(fold, model)).toBe('plain summary');
});
