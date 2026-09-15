import { expect, test } from 'bun:test';
import type { AfterToolCallContext, AgentContext } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { SKILL_SCRATCH_KEY } from '../../skills/types';
import type { AtriumTool } from '../../tools';
import { composeCapabilities } from '../capabilities/compose';
import { loopDetection } from '../capabilities/loop-detection';
import { skillToolScope } from '../capabilities/skill-tool-scope';

const message = fauxAssistantMessage('done');
const turn = () => ({
  message,
  toolResults: [],
  newMessages: [],
  context: { messages: [], tools: [], systemPrompt: 'initial' },
});

test('empty registration installs no hooks', () => {
  expect(composeCapabilities([])).toEqual({});
});

test('context transforms run in order and retain skip-on-error behavior', async () => {
  const hooks = composeCapabilities([
    { name: 'first', transformContext: async (messages) => [...messages, message] },
    {
      name: 'broken',
      transformContext: async () => {
        throw new Error('injection failed');
      },
    },
    {
      name: 'last',
      transformContext: async (messages) => {
        expect(messages).toEqual([message]);
        return [...messages, message];
      },
    },
  ]);
  expect(await hooks.transformContext?.([])).toHaveLength(2);
});

test('tool checks short-circuit with the original decision and signal', async () => {
  const signal = new AbortController().signal;
  const decision = { block: true, terminate: true, reason: 'waiting' };
  const seen: string[] = [];
  const hooks = composeCapabilities([
    {
      name: 'allow',
      beforeToolCall: async (_context, received) => {
        expect(received).toBe(signal);
        seen.push('allow');
        return undefined;
      },
    },
    {
      name: 'block',
      beforeToolCall: async () => {
        seen.push('block');
        return decision;
      },
    },
    {
      name: 'later',
      beforeToolCall: async () => {
        seen.push('later');
        return undefined;
      },
    },
  ]);
  expect(
    await hooks.beforeToolCall?.(
      {
        assistantMessage: message,
        toolCall: { type: 'toolCall', id: '1', name: 'read_file', arguments: {} },
        args: {},
        context: turn().context,
      },
      signal,
    ),
  ).toBe(decision);
  expect(seen).toEqual(['allow', 'block']);
});

test('after-tool hooks see prior result changes and keep omitted fields', async () => {
  const original: AfterToolCallContext = {
    assistantMessage: message,
    toolCall: { type: 'toolCall', id: '1', name: 'read_file', arguments: {} },
    args: {},
    context: turn().context,
    isError: false,
    result: { content: [{ type: 'text', text: 'original' }], details: {} },
  };
  const hooks = composeCapabilities([
    {
      name: 'first',
      afterToolCall: async () => ({
        content: [{ type: 'text', text: 'changed' }],
        details: { first: true },
        isError: true,
        terminate: true,
      }),
    },
    {
      name: 'second',
      afterToolCall: async ({ result, isError }) => {
        expect(result.content).toEqual([{ type: 'text', text: 'changed' }]);
        expect(isError).toBe(true);
        return { content: undefined, details: { second: true }, isError: false };
      },
    },
  ]);
  expect(await hooks.afterToolCall?.(original)).toMatchObject({
    content: [{ type: 'text', text: 'changed' }],
    details: { second: true },
    isError: false,
    terminate: true,
  });
  expect(original.result.content).toEqual([{ type: 'text', text: 'original' }]);
});

test('skill tools restore on exit but never override a triggered loop restriction', async () => {
  const tools = ['read_file', 'bash'].map((name) => ({ name }) as AtriumTool);
  const scratch = new Map();
  const hooks = composeCapabilities([skillToolScope(tools, scratch), loopDetection()]);
  let context: AgentContext = { ...turn().context, tools };
  scratch.set(SKILL_SCRATCH_KEY, { name: 'read-only', allowedTools: ['Read'] });
  context = (await hooks.prepareNextTurn?.({ ...turn(), context }))?.context ?? context;
  expect(context.tools?.map((t) => t.name)).toEqual(['read_file']);
  scratch.clear();
  context = (await hooks.prepareNextTurn?.({ ...turn(), context }))?.context ?? context;
  expect(context.tools).toEqual(tools);
  const repeated = fauxAssistantMessage([
    { type: 'toolCall', id: '1', name: 'bash', arguments: {} },
  ]);
  for (let i = 0; i < 5; i++) {
    context =
      (await hooks.prepareNextTurn?.({ ...turn(), message: repeated, context }))?.context ??
      context;
  }
  expect(context.tools).toEqual([]);
  context = (await hooks.prepareNextTurn?.({ ...turn(), context }))?.context ?? context;
  expect(context.tools).toEqual([]);
  expect(JSON.stringify(await hooks.transformContext?.([]))).toContain('Loop detected');
  const fresh = composeCapabilities([loopDetection()]);
  expect(
    (await fresh.prepareNextTurn?.({ ...turn(), context: { ...context, tools } }))?.context?.tools,
  ).toEqual(tools);
});

test('decision failures propagate and cancellation stops further preparation', async () => {
  const abort = new AbortController();
  const seen: string[] = [];
  const hooks = composeCapabilities([
    {
      name: 'cancel',
      prepareNextTurn: () => {
        abort.abort();
        return undefined;
      },
    },
    {
      name: 'later',
      prepareNextTurn: () => {
        seen.push('later');
        return undefined;
      },
    },
  ]);
  await expect(hooks.prepareNextTurn?.(turn(), abort.signal)).rejects.toThrow();
  expect(seen).toEqual([]);
  const failed = composeCapabilities([
    {
      name: 'failed',
      shouldStopAfterTurn: () => {
        throw new Error('policy failed');
      },
    },
  ]);
  await expect(failed.shouldStopAfterTurn?.(turn())).rejects.toThrow('policy failed');
});

test('one registered capability shares state across context and next-turn hooks', async () => {
  let observed = false;
  const hooks = composeCapabilities([
    {
      name: 'shared-state',
      prepareNextTurn: () => {
        observed = true;
        return undefined;
      },
      transformContext: async (messages) => (observed ? [...messages, message] : messages),
    },
  ]);
  await hooks.prepareNextTurn?.(turn());
  expect(await hooks.transformContext?.([])).toEqual([message]);
});

test('next-turn updates preserve earlier model updates and pass context in order', async () => {
  const model = fauxProvider().getModel();
  const hooks = composeCapabilities([
    {
      name: 'first',
      prepareNextTurn: ({ context }) => ({
        model,
        thinkingLevel: 'off',
        context: { ...context, systemPrompt: 'first' },
      }),
    },
    {
      name: 'second',
      prepareNextTurn: ({ context }) => {
        expect(context.systemPrompt).toBe('first');
        return { context: { ...context, systemPrompt: 'second' } };
      },
    },
  ]);
  expect(await hooks.prepareNextTurn?.(turn())).toMatchObject({
    model,
    thinkingLevel: 'off',
    context: { systemPrompt: 'second' },
  });
});

test('stopping short-circuits later capabilities', async () => {
  const seen: string[] = [];
  const hooks = composeCapabilities([
    {
      name: 'stop',
      shouldStopAfterTurn: async () => {
        seen.push('stop');
        return true;
      },
    },
    {
      name: 'later',
      shouldStopAfterTurn: () => {
        seen.push('later');
        return false;
      },
    },
  ]);
  expect(await hooks.shouldStopAfterTurn?.(turn())).toBe(true);
  expect(seen).toEqual(['stop']);
});
