import { expect, test } from 'bun:test';
import type { AgentSessionEvent, Message, ToolResultMessage } from '@shared/protocol';
import type { AtriumTool } from '../tools';
import { applyResolutions, toolCallsById } from './approvals';

const call = (id: string, name = 'bash'): Message =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: { command: `echo ${id}` } }],
    api: 'anthropic-messages',
    provider: 'p',
    model: 'm',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 0,
  }) as unknown as Message;

const tool = (name: string, run: (args: unknown) => unknown): AtriumTool =>
  ({
    name,
    execute: async (_id: string, args: unknown) => ({
      content: [{ type: 'text', text: String(run(args)) }],
      details: run(args),
    }),
  }) as unknown as AtriumTool;

const textOf = (m: ToolResultMessage) => m.content.map((c) => ('text' in c ? c.text : '')).join('');

const run = (
  resolutions: Parameters<typeof applyResolutions>[0]['resolutions'],
  messages: Message[],
  tools: AtriumTool[] = [tool('bash', (a) => `ran ${(a as { command: string }).command}`)],
) => {
  const events: AgentSessionEvent[] = [];
  return {
    events,
    done: applyResolutions({
      resolutions,
      messages,
      tools,
      emit: (event) => events.push(event),
    }),
  };
};

test('finds every call in the transcript by id', () => {
  const calls = toolCallsById([call('c1'), call('c2', 'read_file')]);
  expect([...calls.keys()]).toEqual(['c1', 'c2']);
  expect(calls.get('c2')?.name).toBe('read_file');
});

test('nothing to settle produces nothing', async () => {
  const { done, events } = run([], [call('c1')]);
  expect(await done).toEqual([]);
  expect(events).toEqual([]);
});

test('an approved call runs and reports the ordinary execution bracket', async () => {
  const { done, events } = run([{ toolCallId: 'c1', kind: 'approved' }], [call('c1')]);
  const [result] = await done;
  expect(result.isError).toBe(false);
  expect(textOf(result)).toBe('ran echo c1');
  expect(events.map((e) => e.type)).toEqual(['tool_execution_start', 'tool_execution_end']);
});

test('a denied call is stored as denied so the card can say so', async () => {
  const { done, events } = run(
    [{ toolCallId: 'c1', kind: 'denied', reason: 'too risky' }],
    [call('c1')],
  );
  const [result] = await done;
  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ denied: true, errorText: 'too risky' });
  expect(textOf(result)).toBe('too risky');
  // Nothing ran, so there is no execution to report.
  expect(events).toEqual([]);
});

test('a denial with no reason still tells the model not to retry', async () => {
  const [result] = await run([{ toolCallId: 'c1', kind: 'denied' }], [call('c1')]).done;
  expect(textOf(result)).toMatch(/denied/i);
  expect(textOf(result)).toMatch(/not retry/i);
});

test("an answered call carries the user's own output through", async () => {
  const output = { answers: ['blue'] };
  const [result] = await run(
    [{ toolCallId: 'c1', kind: 'answered', output }],
    [call('c1', 'ask_clarification')],
  ).done;
  expect(result.isError).toBe(false);
  expect(result.details).toBe(output);
  expect(textOf(result)).toBe('{"answers":["blue"]}');
});

test('a tool that failed on approval is reported as an error, not a crash', async () => {
  const failing = {
    name: 'bash',
    execute: async () => {
      throw new Error('exit 1');
    },
  } as unknown as AtriumTool;
  const { done, events } = run([{ toolCallId: 'c1', kind: 'approved' }], [call('c1')], [failing]);
  const [result] = await done;
  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ errorText: 'exit 1' });
  expect(events.at(-1)).toMatchObject({ type: 'tool_execution_end', isError: true });
});

test('a tool that no longer exists resolves the call rather than leaving it open', async () => {
  const [result] = await run([{ toolCallId: 'c1', kind: 'approved' }], [call('c1')], []).done;
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('no longer available');
});

test('a decision about a call the transcript lost is dropped', async () => {
  const { done, events } = run([{ toolCallId: 'gone', kind: 'approved' }], [call('c1')]);
  expect(await done).toEqual([]);
  expect(events).toEqual([]);
});
