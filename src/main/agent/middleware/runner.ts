import type {
  AgentMiddleware,
  MetadataPart,
  RunContext,
  RunResultInfo,
  StepInfo,
  StepOverride,
  StepResultInfo,
  ToolCallInfo,
  ToolShortCircuit,
} from './types';

/**
 * The middleware chain folded into the callbacks streamText expects. These are
 * pure over the middleware list + RunContext — the AI SDK adapter (see run.ts)
 * feeds streamText's prepareStep / onStepFinish / messageMetadata and the tool
 * execute wrappers into them. Order: forward for everything except afterToolUse
 * (reverse, so it unwinds the beforeToolUse onion).
 */

export async function runBeforeRun(ctx: RunContext, mws: AgentMiddleware[]): Promise<void> {
  for (const m of mws) await m.beforeRun?.(ctx);
}

export async function runAfterRun(
  ctx: RunContext,
  result: RunResultInfo,
  mws: AgentMiddleware[],
): Promise<void> {
  for (const m of mws) await m.afterRun?.(ctx, result);
}

export function composeBeforeStep(ctx: RunContext, mws: AgentMiddleware[]) {
  return async (step: StepInfo): Promise<StepOverride> => {
    const merged: StepOverride = {};
    for (const m of mws) {
      // Each middleware sees the merged-so-far message view, so an appender
      // composes with an upstream rewrite instead of clobbering it. Scalar
      // fields stay last-wins.
      const o = await m.beforeStep?.(ctx, { ...step, messages: merged.messages ?? step.messages });
      if (o) Object.assign(merged, o);
    }
    return merged;
  };
}

export function composeAfterStep(ctx: RunContext, mws: AgentMiddleware[]) {
  return async (step: StepResultInfo): Promise<void> => {
    for (const m of mws) await m.afterStep?.(ctx, step);
  };
}

/** First middleware to return a short-circuit wins; the rest don't run. */
export async function runBeforeToolUse(
  ctx: RunContext,
  call: ToolCallInfo,
  mws: AgentMiddleware[],
): Promise<ToolShortCircuit | undefined> {
  for (const m of mws) {
    const sc = await m.beforeToolUse?.(ctx, call);
    if (sc) return sc;
  }
  return undefined;
}

/** Reverse order: unwinds the beforeToolUse onion. Each may replace the result. */
export async function runAfterToolUse(
  ctx: RunContext,
  call: ToolCallInfo,
  result: unknown,
  mws: AgentMiddleware[],
): Promise<unknown> {
  let acc = result;
  for (let i = mws.length - 1; i >= 0; i--) {
    const r = await mws[i].afterToolUse?.(ctx, call, acc);
    if (r !== undefined) acc = r;
  }
  return acc;
}

export function composeMessageMetadata(mws: AgentMiddleware[]) {
  return (part: MetadataPart): Record<string, unknown> | undefined => {
    let acc: Record<string, unknown> | undefined;
    for (const m of mws) {
      const md = m.messageMetadata?.(part);
      if (md) acc = { ...acc, ...md };
    }
    return acc;
  };
}
