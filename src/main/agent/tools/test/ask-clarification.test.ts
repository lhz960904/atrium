import { expect, mock, test } from 'bun:test';
import type { ToolCall } from '@earendil-works/pi-ai';
import { askClarificationTool } from '../builtins/ask-clarification';

const questions = [{ header: 'Choice', question: 'Which one?', inputType: 'text' as const }];

test("the user's answer comes back as the tool result", async () => {
  const result = {
    content: [{ type: 'text' as const, text: 'Which one? A' }],
    details: { answers: [{ question: 'Which one?', answer: 'A' }] },
  };
  const ask = mock(async (_call: ToolCall) => result);
  const tool = askClarificationTool(ask);
  const signal = new AbortController().signal;
  expect(await tool.execute('c1', { questions }, signal)).toEqual(result);
  expect(ask).toHaveBeenCalledWith(
    { type: 'toolCall', id: 'c1', name: 'ask_clarification', arguments: { questions } },
    signal,
  );
});

test('without a way to reach the user the tool says it cannot ask', async () => {
  await expect(askClarificationTool().execute('c1', { questions })).rejects.toThrow(
    'User interaction is unavailable in this context.',
  );
});

test('a run that was already cancelled does not ask', async () => {
  const ask = mock(async () => ({ content: [], details: { answers: [] } }));
  const abort = new AbortController();
  abort.abort();
  await expect(
    askClarificationTool(ask).execute('c1', { questions }, abort.signal),
  ).rejects.toThrow();
  expect(ask).not.toHaveBeenCalled();
});
