import { composeContext } from '../context/compose';
import { injectSystemReminder } from '../context/system-reminder';
import { currentDateNote } from '../prompts';
import type { AtriumTool } from '../tools';
import type { AgentLoopOptions } from './agent-loop';
import { createLoopDetector } from './loop-detection';

/** Explicit chat/subagent policy: date, repetition detection and a turn cap. */
export function withChatPolicies(
  opts: Omit<AgentLoopOptions, 'maxTurns'> & {
    toolsForNextTurn?: () => AtriumTool[];
  },
): AgentLoopOptions {
  const { toolsForNextTurn, ...base } = opts;
  const detector = createLoopDetector();
  const transformChatContext = composeContext([
    (messages) => injectSystemReminder(messages, currentDateNote(new Date()), { anchor: 'last' }),
    detector.transform,
  ]);
  return {
    ...base,
    maxTurns: 100,

    transformContext: async (messages, signal) =>
      transformChatContext((await opts.transformContext?.(messages, signal)) ?? messages),
    prepareNextTurn: async (turn, signal) => {
      const update = await opts.prepareNextTurn?.(turn, signal);
      const context = update?.context ?? turn.context;
      detector.observe(turn.message);
      const tools = detector.stopped ? [] : (toolsForNextTurn?.() ?? context.tools);
      return { ...update, context: { ...context, tools } };
    },
  };
}
