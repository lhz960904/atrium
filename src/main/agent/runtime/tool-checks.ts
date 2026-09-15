import type { AgentOptions } from '@earendil-works/pi-agent-core';

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
