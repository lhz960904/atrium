import {
  Agent,
  type AgentEvent,
  type AgentOptions,
  convertToLlm,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { Message } from '@shared/protocol';
import { currentDateNote } from '../prompts';
import type { AtriumTool } from '../tools';
import { type ContextTransform, composeContext } from './context';
import { injectSystemReminder } from './history';
import { createLoopDetector } from './loop-detection';
import { asPi } from './vocabulary';

/** Complex work routinely runs a dozen turns; this is the runaway brake. */
const MAX_TURNS = 100;

export type AgentRuntimeOptions = {
  systemPrompt: string;
  model: Model<Api>;
  streamFn: StreamFn;
  getApiKey: (provider: string) => string | undefined;
  /** The transcript the loop starts from. */
  messages: Message[];
  tools: AtriumTool[];
  /**
   * Rewrites of the model's view, in the order they apply. The date note and
   * the loop notice are appended after them: the date must land on the current
   * turn before any notice can claim that anchor, and the loop notice goes last
   * so it sits closest to what the model is about to answer.
   */
  transforms?: (ContextTransform | false | undefined)[];
  /** The tools to offer for the next turn; defaults to the full set. */
  toolsForNextTurn?: () => AtriumTool[];
  /** A further reason to end the run after the current turn. */
  stopAfterTurn?: () => boolean;
  beforeToolCall?: AgentOptions['beforeToolCall'];
};

export type AgentRuntime = {
  subscribe(listener: (event: AgentEvent) => void): void;
  /** Run to completion, forwarding an outer stop to the engine. Errors from the
   *  loop itself propagate — what to do about one differs per caller. */
  run(signal?: AbortSignal): Promise<void>;
};

/**
 * An Atrium agent loop: pi's `Agent` plus the wiring every loop in the app
 * shares — the context pipeline, the repetition brake, the turn cap and stop
 * forwarding. The chat turn and a subagent differ in what they put in front of
 * the model and what they do with its events, not in how the loop is built, so
 * only those differences are passed in.
 *
 * The repetition brake lives here rather than at a call site because it spans
 * two hooks that have to agree: it tallies each finished turn's calls through
 * `prepareNextTurnWithContext` and, once tripped, offers no tools at all — the
 * model then has to answer in text.
 */
export function createAgentRuntime(opts: AgentRuntimeOptions): AgentRuntime {
  const loop = createLoopDetector();
  let turns = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      tools: opts.tools,
      messages: asPi(opts.messages),
    },
    streamFn: opts.streamFn,
    getApiKey: opts.getApiKey,
    // pi's own converter, not the default: a transcript read back from the
    // session can hold pi's message roles — a compaction summary above all —
    // and the default would silently drop them instead of framing them.
    convertToLlm,
    transformContext: composeContext([
      ...(opts.transforms ?? []),
      (messages) => injectSystemReminder(messages, currentDateNote(new Date()), { anchor: 'last' }),
      loop.transform,
    ]),
    prepareNextTurnWithContext: async ({ message, context }) => {
      loop.observe(message);
      const tools = loop.stopped ? [] : (opts.toolsForNextTurn?.() ?? opts.tools);
      return { context: { ...context, tools } };
    },
    shouldStopAfterTurn: () => ++turns >= MAX_TURNS || (opts.stopAfterTurn?.() ?? false),
    beforeToolCall: opts.beforeToolCall,
  });

  return {
    subscribe: (listener) => {
      agent.subscribe(listener);
    },
    async run(signal) {
      const stop = () => agent.abort();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        await agent.continue();
      } finally {
        signal?.removeEventListener('abort', stop);
      }
    },
  };
}
