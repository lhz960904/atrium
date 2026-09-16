import type {
  AfterToolCallResult,
  AgentLoopTurnUpdate,
  AgentOptions,
} from '@earendil-works/pi-agent-core';
import { composeContext } from '../context/compose';
import type { AgentLoopOptions } from './agent-loop';

type BeforeToolCall = NonNullable<AgentOptions['beforeToolCall']>;

/** Ordered gates: only a blocking decision short-circuits; errors propagate to pi. */
export function composeBeforeToolCall(checks: BeforeToolCall[]): BeforeToolCall {
  return async (context, signal) => {
    for (const check of checks) {
      signal?.throwIfAborted();
      const decision = await check(context, signal);
      if (decision?.block) return decision;
    }
    return undefined;
  };
}

export type Hooks = Pick<
  AgentLoopOptions,
  | 'transformContext'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'prepareNextTurn'
  | 'shouldStopAfterTurn'
>;
/** One module's named contribution to the loop's hooks. */
export type HookSet = { name: string } & Hooks;

/** List order applies within each hook; pi owns the order between hook phases. */
export function composeHooks(sets: HookSet[]): Hooks {
  const hooks: Hooks = {};
  const transforms = sets.flatMap((c) => (c.transformContext ? [c.transformContext] : []));
  const before = sets.flatMap((c) => (c.beforeToolCall ? [c.beforeToolCall] : []));
  const after = sets.flatMap((c) => (c.afterToolCall ? [c.afterToolCall] : []));
  const prepare = sets.flatMap((c) => (c.prepareNextTurn ? [c.prepareNextTurn] : []));
  const stop = sets.flatMap((c) => (c.shouldStopAfterTurn ? [c.shouldStopAfterTurn] : []));
  if (transforms.length)
    hooks.transformContext = (messages, signal) =>
      composeContext(transforms.map((transform) => (messages) => transform(messages, signal)))(
        messages,
      );
  if (before.length) hooks.beforeToolCall = composeBeforeToolCall(before);
  if (after.length)
    hooks.afterToolCall = async (context, signal) => {
      const merged: AfterToolCallResult = {};
      let current = context;
      for (const hook of after) {
        signal?.throwIfAborted();
        const update = await hook(current, signal);
        if (!update) continue;
        if (update.content !== undefined) merged.content = update.content;
        if (update.details !== undefined) merged.details = update.details;
        if (update.isError !== undefined) merged.isError = update.isError;
        if (update.usage !== undefined) merged.usage = update.usage;
        if (update.terminate !== undefined) merged.terminate = update.terminate;
        current = {
          ...context,
          result: {
            ...context.result,
            ...(merged.content !== undefined ? { content: merged.content } : {}),
            ...(merged.details !== undefined ? { details: merged.details } : {}),
            ...(merged.usage !== undefined ? { usage: merged.usage } : {}),
          },
          isError: merged.isError ?? context.isError,
        };
      }
      return merged;
    };
  if (prepare.length)
    hooks.prepareNextTurn = async (turn, signal) => {
      const merged: AgentLoopTurnUpdate = {};
      for (const hook of prepare) {
        signal?.throwIfAborted();
        const update = await hook({ ...turn, context: merged.context ?? turn.context }, signal);
        if (!update) continue;
        if (update.context !== undefined) merged.context = update.context;
        if (update.model !== undefined) merged.model = update.model;
        if (update.thinkingLevel !== undefined) merged.thinkingLevel = update.thinkingLevel;
      }
      return merged;
    };
  if (stop.length)
    hooks.shouldStopAfterTurn = async (turn, signal) => {
      for (const hook of stop) {
        signal?.throwIfAborted();
        if (await hook(turn, signal)) return true;
      }
      return false;
    };
  return hooks;
}
