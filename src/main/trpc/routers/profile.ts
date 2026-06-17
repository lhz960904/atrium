import { parseDisplayName, readSoul, readUser } from '../../agent/profile';
import { publicProcedure, router } from '../trpc';

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
});
