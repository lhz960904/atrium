import { z } from 'zod';
import { parseDisplayName, readSoul, readUser } from '../../agent/profile';
import { profileDir } from '../../agent/profile/paths';
import { dispatchProfile } from '../../agent/tools/builtins/profile';
import { publicProcedure, router } from '../trpc';

const target = z.enum(['soul', 'user']);

export const profileRouter = router({
  /** The name to greet the user by (from USER.md), or null when unset. */
  displayName: publicProcedure.query(async (): Promise<string | null> => {
    return parseDisplayName(await readUser());
  }),

  /** True when neither identity file exists yet — the home view offers onboarding. */
  needsOnboarding: publicProcedure.query(async (): Promise<boolean> => {
    const [soul, user] = await Promise.all([readSoul(), readUser()]);
    return !soul && !user;
  }),

  /** Raw markdown of an identity file, '' when unset — the settings editor binds to this. */
  get: publicProcedure.input(z.object({ target })).query(({ input }) => {
    return input.target === 'soul' ? readSoul() : readUser();
  }),

  set: publicProcedure
    .input(z.object({ target, content: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await dispatchProfile(profileDir(), { command: 'write', ...input });
      return { ok: true };
    }),
});
