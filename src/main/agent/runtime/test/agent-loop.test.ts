import { expect, expectTypeOf, test } from 'bun:test';
import type { AgentOptions } from '@earendil-works/pi-agent-core';
import { createModels, fauxAssistantMessage, fauxProvider, Type } from '@earendil-works/pi-ai';
import { composeContext } from '../../context/compose';
import { type AgentLoopOptions, createAgentLoop } from '../agent-loop';
import { composeCapabilities } from '../capabilities/compose';
import { dateReminder } from '../capabilities/context';
import { loopDetection } from '../capabilities/loop-detection';
import { composeBeforeToolCall } from '../tool-checks';

test('loop accepts pi-compatible single callbacks', () => {
  expectTypeOf<AgentLoopOptions['transformContext']>().toEqualTypeOf<
    AgentOptions['transformContext']
  >();
  expectTypeOf<AgentLoopOptions['beforeToolCall']>().toEqualTypeOf<
    AgentOptions['beforeToolCall']
  >();
});

function fixture(overrides: Partial<AgentLoopOptions> = {}) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const options: AgentLoopOptions = {
    model: faux.getModel(),
    streamFn: models.streamSimple.bind(models),
    systemPrompt: 'Configured system',
    messages: [{ role: 'user', content: 'Configured prompt', timestamp: 0 }],
    tools: [],
    maxTurns: 1,
    ...overrides,
  };
  return { faux, options, loop: createAgentLoop(options) };
}

test('AgentLoop exposes execution only, not single-request completion', () => {
  expect(fixture().loop).not.toHaveProperty('complete');
});

test('run honors configured history and system, without injecting chat context', async () => {
  const { faux, loop } = fixture({
    messages: [
      { role: 'user', content: 'earlier', timestamp: 0 },
      { role: 'user', content: 'current', timestamp: 1 },
    ],
  });
  faux.setResponses([
    (context) => {
      expect(context.systemPrompt).toBe('Configured system');
      expect(context.messages).toHaveLength(2);
      expect(context.messages[0].content).toBe('earlier');
      expect(context.messages[1].content).toBe('current');
      expect(context.tools).toEqual([]);
      return fauxAssistantMessage([
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: ' first' },
        { type: 'text', text: 'second ' },
      ]);
    },
  ]);
  await loop.run();
  expect(faux.state.callCount).toBe(1);
});

test('run uses caller tools, transforms, subscriptions and turn limit', async () => {
  let executed = 0;
  let transformed = 0;
  let observed = 0;
  const { faux, loop } = fixture({
    maxTurns: 2,
    tools: [
      {
        name: 'echo',
        label: 'echo',
        description: 'echo',
        parameters: Type.Object({}),
        execute: async () => {
          executed++;
          return { content: [{ type: 'text', text: 'tool answer' }], details: {} };
        },
      },
    ],

    transformContext: composeContext([
      (messages) => {
        transformed++;
        return messages;
      },
    ]),
  });
  faux.setResponses([
    fauxAssistantMessage([{ type: 'toolCall', id: 'call-1', name: 'echo', arguments: {} }], {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('final answer'),
  ]);
  loop.subscribe(() => {
    observed++;
  });
  await loop.run();
  expect(executed).toBe(1);
  expect(transformed).toBe(2);
  expect(observed).toBeGreaterThan(0);
  expect(faux.state.callCount).toBe(2);
});

test('maxTurns stops a tool cycle before another model request', async () => {
  const { faux, loop } = fixture();
  faux.setResponses([
    fauxAssistantMessage(
      [{ type: 'toolCall', id: 'missing', name: 'unavailable', arguments: {} }],
      { stopReason: 'toolUse' },
    ),
  ]);
  await loop.run();
  expect(faux.state.callCount).toBe(1);
});

test.each([false, true])('tool hooks are awaited and can block execution: %s', async (block) => {
  const order: string[] = [];
  const { faux, loop } = fixture({
    maxTurns: 2,
    tools: [
      {
        name: 'echo',
        label: 'echo',
        description: 'echo',
        parameters: Type.Object({}),
        execute: async () => {
          order.push('execute');
          return { content: [{ type: 'text', text: 'original' }], details: {} };
        },
      },
    ],

    beforeToolCall: composeBeforeToolCall([
      async () => {
        await Promise.resolve();
        order.push('before');
        if (block) return { block: true, reason: 'blocked by policy' };
        return undefined;
      },
    ]),
    afterToolCall: async () => {
      await Promise.resolve();
      order.push('after');
      return { content: [{ type: 'text', text: 'rewritten' }] };
    },
  });
  faux.setResponses([
    fauxAssistantMessage([{ type: 'toolCall', id: 'echo-1', name: 'echo', arguments: {} }], {
      stopReason: 'toolUse',
    }),
    (context) => {
      const result = context.messages.find((message) => message.role === 'toolResult');
      expect(JSON.stringify(result?.content)).toContain(block ? 'blocked by policy' : 'rewritten');
      return fauxAssistantMessage('done');
    },
  ]);
  await loop.run();
  expect(order).toEqual(block ? ['before'] : ['before', 'execute', 'after']);
});

test.each([
  false,
  true,
])('turn hook can stop early but cannot bypass maxTurns: %s', async (stop) => {
  const { faux, loop } = fixture({
    maxTurns: stop ? 5 : 1,
    shouldStopAfterTurn: async () => stop,
  });
  faux.setResponses([
    fauxAssistantMessage(
      [{ type: 'toolCall', id: 'missing', name: 'unavailable', arguments: {} }],
      { stopReason: 'toolUse' },
    ),
  ]);
  await loop.run();
  expect(faux.state.callCount).toBe(1);
});

test('capability composition retains caller prepareNextTurn context updates', async () => {
  let prepared = 0;
  const { faux, options } = fixture({
    prepareNextTurn: async ({ context }) => {
      prepared++;
      return { context: { ...context, systemPrompt: 'updated system', tools: [] } };
    },
  });
  const loop = createAgentLoop({
    ...options,
    maxTurns: 100,
    ...composeCapabilities([
      { name: 'caller', prepareNextTurn: options.prepareNextTurn },
      dateReminder(),
      loopDetection(),
    ]),
  });
  faux.setResponses([
    fauxAssistantMessage(
      [{ type: 'toolCall', id: 'missing', name: 'unavailable', arguments: {} }],
      { stopReason: 'toolUse' },
    ),
    (context) => {
      expect(context.systemPrompt).toBe('updated system');
      expect(context.tools).toEqual([]);
      return fauxAssistantMessage('done');
    },
  ]);
  await loop.run();
  expect(prepared).toBeGreaterThan(0);
});

test.each([
  false,
  true,
])('beforeToolCall composes checks in order and short-circuits: %s', async (block) => {
  const order: string[] = [];
  const { faux, loop } = fixture({
    tools: [
      {
        name: 'echo',
        label: 'echo',
        description: 'echo',
        parameters: Type.Object({}),
        execute: async () => {
          order.push('execute');
          return { content: [{ type: 'text', text: 'ran' }], details: {} };
        },
      },
    ],
    beforeToolCall: composeBeforeToolCall([
      async () => {
        await Promise.resolve();
        order.push('first');
        return { block: false };
      },
      async () => {
        order.push('second');
        return block ? { block: true, terminate: true, reason: 'policy blocked' } : undefined;
      },
      async () => {
        order.push('third');
        return undefined;
      },
    ]),
  });
  faux.setResponses([
    fauxAssistantMessage([{ type: 'toolCall', id: 'echo-1', name: 'echo', arguments: {} }], {
      stopReason: 'toolUse',
    }),
  ]);
  await loop.run();
  expect(order).toEqual(block ? ['first', 'second'] : ['first', 'second', 'third', 'execute']);
});

test.each([
  'error',
  'abort',
] as const)('a %s in a tool check does not run later checks or the tool', async (mode) => {
  const abort = new AbortController();
  const order: string[] = [];
  const { faux, loop } = fixture({
    tools: [
      {
        name: 'echo',
        label: 'echo',
        description: 'echo',
        parameters: Type.Object({}),
        execute: async () => {
          order.push('execute');
          return { content: [{ type: 'text', text: 'ran' }], details: {} };
        },
      },
    ],
    beforeToolCall: composeBeforeToolCall([
      async ({ toolCall }, signal) => {
        expect(toolCall.id).toBe('echo-1');
        expect(signal).toBeInstanceOf(AbortSignal);
        order.push('first');
        if (mode === 'error') throw new Error('check failed');
        abort.abort();
        return undefined;
      },
      async () => {
        order.push('second');
        return undefined;
      },
    ]),
  });
  faux.setResponses([
    fauxAssistantMessage([{ type: 'toolCall', id: 'echo-1', name: 'echo', arguments: {} }], {
      stopReason: 'toolUse',
    }),
  ]);
  await loop.run(abort.signal);
  expect(order).toEqual(['first']);
});

test('overlapping executions are rejected without replacing the active request', async () => {
  const { faux, loop } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  faux.setResponses([
    async () => {
      await gate;
      return fauxAssistantMessage('first');
    },
  ]);
  const first = loop.run();
  const rejected = new AbortController();
  await expect(loop.run(rejected.signal)).rejects.toThrow('Agent is already processing');
  rejected.abort(); // A rejected invocation must detach its listener from the active Agent.
  release();
  await first;
  expect(faux.state.callCount).toBe(1);
});

test('pre-aborted execution makes no request', async () => {
  const { faux, loop } = fixture();
  await expect(loop.run(AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled');
  expect(faux.state.callCount).toBe(0);
});

test('cancelling an active run reaches its provider', async () => {
  const { faux, loop } = fixture();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  faux.setResponses([
    (_context, options) =>
      new Promise((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => resolve(fauxAssistantMessage('', { stopReason: 'aborted' })),
          { once: true },
        );
        started();
      }),
  ]);
  const abort = new AbortController();
  const pending = loop.run(abort.signal);
  await ready;
  abort.abort(new Error('cancelled'));
  await pending;
});

test.each([
  'error',
  'aborted',
] as const)('%s remains observable through pi events', async (stopReason) => {
  const { faux, loop } = fixture();
  let observed: string | undefined;
  loop.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant')
      observed = event.message.stopReason;
  });
  faux.setResponses([fauxAssistantMessage('', { stopReason, errorMessage: 'request stopped' })]);
  await loop.run();
  expect(observed).toBe(stopReason);
});
