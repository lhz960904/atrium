import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { createLogger } from '@main/log';

const log = createLogger('context');

/** One rewrite of what the model sees, applied to a copy of the transcript. */
export type ContextTransform = (
  messages: AgentMessage[],
) => AgentMessage[] | Promise<AgentMessage[]>;

/**
 * Fold the transforms into the single hook the engine calls before each request.
 * They run in list order and each sees the previous one's output, so an appender
 * composes with an upstream rewrite instead of clobbering it.
 *
 * A transform that throws would tear down the loop without its normal event
 * sequence, so a failing one is skipped and the turn proceeds on the view it
 * already had — a missing injection is survivable, a dead turn is not.
 */
export function composeContext(
  transforms: (ContextTransform | false | undefined)[],
): (messages: AgentMessage[]) => Promise<AgentMessage[]> {
  const chain = transforms.filter((t): t is ContextTransform => typeof t === 'function');
  return async (messages) => {
    let acc = messages;
    for (const transform of chain) {
      try {
        acc = await transform(acc);
      } catch (err) {
        log.warn(`context transform skipped: ${err}`);
      }
    }
    return acc;
  };
}
