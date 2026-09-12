import { expect, test } from 'bun:test';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@shared/protocol';
import { createLoopDetector } from './loop-detection';

const turn = (id: string, name: string, args: Record<string, unknown>): AssistantMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
  }) as AssistantMessage;

const history: AgentMessage[] = [{ role: 'user', content: 'fill the form', timestamp: 0 }];

/** What the transform appended to the view, if anything. */
const noticeOf = (messages: AgentMessage[]): string => {
  const last = messages.at(-1);
  return messages.length > history.length && last && 'content' in last ? String(last.content) : '';
};

/** Drive n identical turns through the detector, returning the last view it produced. */
async function repeat(
  detector: ReturnType<typeof createLoopDetector>,
  n: number,
  args: Record<string, unknown> = { text: 'hi' },
) {
  let view = history;
  for (let i = 1; i <= n; i++) {
    detector.observe(turn(`c${i}`, 'browser_type', args));
    view = await detector.transform(history);
  }
  return view;
}

test('warns once when the same call repeats warnAt times', async () => {
  const detector = createLoopDetector();
  expect(noticeOf(await repeat(detector, 2))).toBe('');

  detector.observe(turn('c3', 'browser_type', { text: 'hi' }));
  expect(noticeOf(await detector.transform(history))).toContain('3 times');
  expect(detector.stopped).toBe(false);

  // Fourth repeat: already warned for this key, nothing new until the hard stop.
  detector.observe(turn('c4', 'browser_type', { text: 'hi' }));
  expect(noticeOf(await detector.transform(history))).toBe('');
});

test('the warning is shown once, not on every later request', async () => {
  const detector = createLoopDetector();
  await repeat(detector, 3);
  expect(noticeOf(await detector.transform(history))).toBe('');
});

test('cuts off tool use at stopAt and keeps it off for the rest of the run', async () => {
  const detector = createLoopDetector();
  const view = await repeat(detector, 5);
  expect(detector.stopped).toBe(true);
  expect(noticeOf(view)).toContain('disabled');

  // No new calls, but the stop must hold until the run ends.
  expect(noticeOf(await detector.transform(history))).toContain('disabled');
});

test('different arguments never accumulate into one loop', async () => {
  const detector = createLoopDetector();
  let view = history;
  for (const i of [1, 2, 3, 4, 5]) {
    detector.observe(turn(`c${i}`, 'bash', { command: `ls ${i}` }));
    view = await detector.transform(history);
  }
  expect(noticeOf(view)).toBe('');
  expect(detector.stopped).toBe(false);
});

test('argument key order does not split the identical-call key', async () => {
  const detector = createLoopDetector();
  detector.observe(turn('c1', 'edit', { a: 1, b: 2 }));
  detector.observe(turn('c2', 'edit', { b: 2, a: 1 }));
  detector.observe(turn('c3', 'edit', { a: 1, b: 2 }));
  expect(noticeOf(await detector.transform(history))).toContain('3 times');
});

test('only what it observes is counted — history it never saw does not seed the tally', async () => {
  const detector = createLoopDetector();
  const view = await repeat(detector, 2, { command: 'ls' });
  expect(noticeOf(view)).toBe('');
});

test('ignores turns that made no tool call', async () => {
  const detector = createLoopDetector();
  detector.observe({
    role: 'assistant',
    content: [{ type: 'text', text: 'thinking…' }],
  } as AssistantMessage);
  expect(noticeOf(await detector.transform(history))).toBe('');
});

test('the notice rides on the view, never on the transcript it was given', async () => {
  const detector = createLoopDetector();
  await repeat(detector, 3);
  expect(history).toHaveLength(1);
});
