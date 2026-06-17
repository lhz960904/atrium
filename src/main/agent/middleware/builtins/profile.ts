import { readUser } from '../../profile/paths';
import { injectSystemReminder } from '../shared/reminder';
import type { AgentMiddleware, RunContext } from '../types';

export type ProfileOptions = {
  /** Reads USER.md; defaults to the app-data file. Injectable for tests. */
  readUser?: () => Promise<string>;
};

export function profileMiddleware(opts: ProfileOptions = {}): AgentMiddleware {
  const getUser = opts.readUser ?? readUser;
  return {
    name: 'profile',
    async beforeRun(ctx: RunContext): Promise<void> {
      const user = await getUser();
      if (!user) return;
      ctx.request.messages = injectSystemReminder(
        ctx.request.messages,
        `<user-profile>\nWhat we know about the user — name, background, preferences. Address and tailor to them accordingly.\n\n${user}\n</user-profile>`,
      );
    },
  };
}
