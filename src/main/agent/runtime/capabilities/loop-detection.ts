import { createLoopDetector } from '../loop-detection';
import type { Capability } from './compose';

export function loopDetection(): Capability {
  const detector = createLoopDetector();
  return {
    name: 'loop-detection',
    transformContext: async (messages) => detector.transform(messages),
    prepareNextTurn: ({ context, message }) => {
      detector.observe(message);
      return { context: { ...context, tools: detector.stopped ? [] : context.tools } };
    },
  };
}
