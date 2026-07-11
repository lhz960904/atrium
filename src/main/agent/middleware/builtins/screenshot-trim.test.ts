import { expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import type { RunContext } from '../types';
import { screenshotTrimMiddleware } from './screenshot-trim';

const ctx = {} as RunContext;

/** A computer-tool result: state text (AX tree) plus a screenshot. */
function shot(n: number): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `c${n}`,
        toolName: 'computer_get_app_state',
        output: {
          type: 'content',
          value: [
            { type: 'text', text: `state ${n}` },
            { type: 'image-data', data: `img${n}`, mediaType: 'image/png' },
          ],
        },
      },
    ],
  } as unknown as ModelMessage;
}

function imageCount(messages: ModelMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      const value = (part as { output?: { value?: { type?: string }[] } }).output?.value;
      if (Array.isArray(value)) count += value.filter((v) => v.type === 'image-data').length;
    }
  }
  return count;
}

const run = (keep: number, messages: ModelMessage[]) =>
  screenshotTrimMiddleware(keep).beforeStep?.(ctx, { stepNumber: messages.length, messages });

test('keeps the last N screenshots, drops older images, preserves all text', async () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'do it' },
    shot(1),
    shot(2),
    shot(3),
    shot(4),
  ];
  const out = await run(2, messages);
  const trimmed = out?.messages;
  expect(trimmed).toBeDefined();
  if (!trimmed) return;

  expect(imageCount(trimmed)).toBe(2);
  const dump = JSON.stringify(trimmed);
  expect(dump).toContain('img4');
  expect(dump).toContain('img3');
  expect(dump).not.toContain('img1');
  expect(dump).not.toContain('img2');
  // The text state for the trimmed steps survives.
  expect(dump).toContain('state 1');
  expect(dump).toContain('state 2');
});

test('no-op at or below the keep count', async () => {
  expect(await run(2, [shot(1), shot(2)])).toBeUndefined();
});

test('never removes whole messages', async () => {
  const messages = [shot(1), shot(2), shot(3)];
  const out = await run(1, messages);
  expect(out?.messages?.length).toBe(messages.length);
});
