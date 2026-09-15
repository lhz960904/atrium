import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';
import {
  Agent,
  type AgentOptions,
  convertToLlm,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { AtriumTool } from '../tools';

export type AgentLoopOptions = {
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt: string;
  messages: Message[];
  tools: AtriumTool[];
  /** Maximum model turns, chosen by the caller. */
  maxTurns: number;
  transformContext?: AgentOptions['transformContext'];
  beforeToolCall?: AgentOptions['beforeToolCall'];
  afterToolCall?: AgentOptions['afterToolCall'];
  prepareNextTurn?: AgentOptions['prepareNextTurnWithContext'];
  shouldStopAfterTurn?: AgentOptions['shouldStopAfterTurn'];
  onPayload?: AgentOptions['onPayload'];
  onResponse?: AgentOptions['onResponse'];
};

export type AgentLoop = {
  subscribe: Agent['subscribe'];
  run(signal?: AbortSignal): Promise<void>;
};

/** One configured execution owns one Agent. */
export function createAgentLoop(opts: AgentLoopOptions): AgentLoop {
  if (!Number.isInteger(opts.maxTurns) || opts.maxTurns < 1)
    throw new Error('maxTurns must be a positive integer');
  let turns = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      tools: opts.tools,
      messages: opts.messages,
    },
    streamFn: opts.streamFn,
    convertToLlm,
    transformContext: opts.transformContext,
    prepareNextTurnWithContext: opts.prepareNextTurn,
    shouldStopAfterTurn: async (context, signal) =>
      ++turns >= opts.maxTurns || ((await opts.shouldStopAfterTurn?.(context, signal)) ?? false),
    beforeToolCall: opts.beforeToolCall,
    afterToolCall: opts.afterToolCall,
    onPayload: opts.onPayload,
    onResponse: opts.onResponse,
  });

  async function run(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const stop = () => agent.abort();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await agent.continue();
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  return {
    subscribe: (listener) => agent.subscribe(listener),
    run,
  };
}
