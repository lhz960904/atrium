import { expect, test } from 'bun:test';
import {
  composeAfterStep,
  composeBeforeStep,
  composeMessageMetadata,
  runAfterRun,
  runAfterToolUse,
  runBeforeRun,
  runBeforeToolUse,
} from './runner';
import type {
  AgentMiddleware,
  MetadataPart,
  RunContext,
  RunResultInfo,
  ToolCallInfo,
} from './types';

// The folding helpers never touch db/sandbox, so a bare context is enough.
const ctx = { threadId: 't', scratch: new Map() } as unknown as RunContext;
const call: ToolCallInfo = { name: 'bash', input: {}, toolCallId: 'c1' };

test('runBeforeRun runs every middleware in order with the same context', async () => {
  const order: string[] = [];
  const seen: RunContext[] = [];
  const mw = (name: string): AgentMiddleware => ({
    name,
    beforeRun: (c) => {
      order.push(name);
      seen.push(c);
    },
  });
  await runBeforeRun(ctx, [mw('a'), mw('b'), mw('c')]);
  expect(order).toEqual(['a', 'b', 'c']);
  expect(seen.every((c) => c === ctx)).toBe(true);
});

test('composeBeforeStep merges overrides in order (later wins on conflict)', async () => {
  const mws: AgentMiddleware[] = [
    { name: 'a', beforeStep: () => ({ system: 'a', activeTools: ['bash'] }) },
    { name: 'b', beforeStep: () => undefined },
    { name: 'c', beforeStep: () => ({ system: 'c' }) },
  ];
  const merged = await composeBeforeStep(ctx, mws)({ stepNumber: 0, messages: [] });
  expect(merged).toEqual({ system: 'c', activeTools: ['bash'] });
});

test('composeAfterStep awaits every middleware in order', async () => {
  const order: string[] = [];
  const mw = (name: string): AgentMiddleware => ({
    name,
    afterStep: async () => {
      order.push(name);
    },
  });
  await composeAfterStep(ctx, [mw('a'), mw('b')])({
    stepNumber: 0,
    finishReason: 'stop',
    text: '',
    toolCalls: [],
    toolResults: [],
  });
  expect(order).toEqual(['a', 'b']);
});

test('runBeforeToolUse short-circuits on the first middleware that returns a result', async () => {
  const ran: string[] = [];
  const mws: AgentMiddleware[] = [
    {
      name: 'a',
      beforeToolUse: () => {
        ran.push('a');
      },
    },
    {
      name: 'gate',
      beforeToolUse: () => {
        ran.push('gate');
        return { result: 'denied' };
      },
    },
    {
      name: 'never',
      beforeToolUse: () => {
        ran.push('never');
      },
    },
  ];
  const sc = await runBeforeToolUse(ctx, call, mws);
  expect(sc).toEqual({ result: 'denied' });
  expect(ran).toEqual(['a', 'gate']); // 'never' skipped
});

test('runAfterToolUse threads the result through middlewares in reverse', async () => {
  const order: string[] = [];
  const mws: AgentMiddleware[] = [
    {
      name: 'a',
      afterToolUse: (_c, _call, r) => {
        order.push('a');
        return `${r}-a`;
      },
    },
    {
      name: 'b',
      afterToolUse: (_c, _call, r) => {
        order.push('b');
        return `${r}-b`;
      },
    },
  ];
  const out = await runAfterToolUse(ctx, call, 'out', mws);
  expect(order).toEqual(['b', 'a']); // reverse
  expect(out).toBe('out-b-a');
});

test('runAfterToolUse keeps the prior result when a middleware returns undefined', async () => {
  const mws: AgentMiddleware[] = [
    { name: 'pass', afterToolUse: () => undefined },
    { name: 'tag', afterToolUse: (_c, _call, r) => `${r}!` },
  ];
  expect(await runAfterToolUse(ctx, call, 'x', mws)).toBe('x!');
});

test('composeMessageMetadata merges every middleware return', () => {
  const mws: AgentMiddleware[] = [
    { name: 'a', messageMetadata: (p) => (p.type === 'start' ? { createdAt: 1 } : undefined) },
    { name: 'b', messageMetadata: () => ({ model: 'x' }) },
  ];
  expect(composeMessageMetadata(mws)({ type: 'start' })).toEqual({ createdAt: 1, model: 'x' });
});

test('composeMessageMetadata returns undefined when no middleware contributes', () => {
  const mws: AgentMiddleware[] = [{ name: 'a', messageMetadata: () => undefined }];
  expect(composeMessageMetadata(mws)({ type: 'finish' } as MetadataPart)).toBeUndefined();
});

test('runAfterRun runs every middleware in order', async () => {
  const order: string[] = [];
  const message = { id: 'm', role: 'assistant', parts: [] } as RunResultInfo['message'];
  const mw = (name: string): AgentMiddleware => ({
    name,
    afterRun: () => {
      order.push(name);
    },
  });
  await runAfterRun(ctx, { message }, [mw('a'), mw('b')]);
  expect(order).toEqual(['a', 'b']);
});
