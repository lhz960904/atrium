import type { TrustRule } from '@shared/permissions/rules';
import { SETTINGS_DEFAULTS, type Settings, SettingsPatchSchema } from '@shared/settings';
import { z } from 'zod';
import { getSettings } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

const ruleInput = z.object({ tool: z.string(), matcher: z.string() });
const sameRule = (a: TrustRule, b: TrustRule): boolean =>
  a.tool === b.tool && a.matcher === b.matcher;

const permissions = () => getSettings().get('permissions', SETTINGS_DEFAULTS.permissions);

export const settingsRouter = router({
  /** The full settings object — persisted values over defaults, per scope. The
   *  single read for every preference; the renderer's `useSetting` selects in. */
  all: publicProcedure.query((): Settings => {
    const store = getSettings().store;
    return {
      general: { ...SETTINGS_DEFAULTS.general, ...store.general },
      appearance: { ...SETTINGS_DEFAULTS.appearance, ...store.appearance },
      permissions: { ...SETTINGS_DEFAULTS.permissions, ...store.permissions },
    };
  }),

  /** Merge a scoped partial patch into settings. The generic writer for every
   *  preference, so adding a setting needs no new procedure. */
  patch: publicProcedure.input(SettingsPatchSchema).mutation(({ input }) => {
    const conf = getSettings();
    for (const scope of Object.keys(input) as (keyof Settings)[]) {
      const cur = conf.get(scope, SETTINGS_DEFAULTS[scope]);
      conf.set(scope, { ...cur, ...input[scope] });
    }
  }),

  // permissions.trustRules keeps dedicated procedures: add/delete carry dedup
  // logic a blind patch can't express.
  trustRules: publicProcedure.query((): TrustRule[] => {
    return permissions().trustRules;
  }),

  addTrustRule: publicProcedure.input(ruleInput).mutation(({ input }) => {
    const rule = input as TrustRule;
    const cur = permissions();
    if (!cur.trustRules.some((r) => sameRule(r, rule))) {
      getSettings().set('permissions', { ...cur, trustRules: [...cur.trustRules, rule] });
    }
  }),

  deleteTrustRule: publicProcedure.input(ruleInput).mutation(({ input }) => {
    const rule = input as TrustRule;
    const cur = permissions();
    getSettings().set('permissions', {
      ...cur,
      trustRules: cur.trustRules.filter((r) => !sameRule(r, rule)),
    });
  }),
});
