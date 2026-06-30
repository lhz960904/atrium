import { currentDateNote } from '../../prompts';
import { injectSystemReminder } from '../shared/reminder';
import type { AgentMiddleware, RunContext } from '../types';

/**
 * Anchors "today" so the model doesn't fall back to its training cutoff (e.g.
 * searching for last year's data). The note rides on the latest user turn rather
 * than the system prompt, which keeps the cached system prefix byte-stable, and
 * it's recomputed every turn — so a conversation that crosses midnight picks up
 * the new date on its next message with no explicit staleness tracking. `now` is
 * injectable for tests.
 */
export function dateMiddleware(now: () => Date = () => new Date()): AgentMiddleware {
  return {
    name: 'date',
    beforeRun(ctx: RunContext): void {
      ctx.request.messages = injectSystemReminder(ctx.request.messages, currentDateNote(now()), {
        anchor: 'last',
      });
    },
  };
}
