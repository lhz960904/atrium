import { parseDisplayName, readUser } from '../../agent/profile';
import { publicProcedure, router } from '../trpc';

export const profileRouter = router({
  /** The name to greet the user by (from USER.md), or null when unset. */
  displayName: publicProcedure.query(async (): Promise<string | null> => {
    return parseDisplayName(await readUser());
  }),
});
