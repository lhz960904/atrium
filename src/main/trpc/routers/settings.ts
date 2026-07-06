import type { TrustRule } from '@shared/permissions/rules';
import { type Settings, SettingsPatchSchema } from '@shared/settings';
import { app } from 'electron';
import { z } from 'zod';
import { syncBrowserProvisioning } from '../../agent/mcp/browser-provisioner';
import { getSettings } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

const ruleInput = z.object({ tool: z.string(), matcher: z.string() });
const sameRule = (a: TrustRule, b: TrustRule): boolean =>
  a.tool === b.tool && a.matcher === b.matcher;

const permissions = () => getSettings('permissions');

export const settingsRouter = router({
  /** The full settings object — persisted values over defaults, per scope. The
   *  single read for every preference; the renderer's `useSetting` selects in. */
  all: publicProcedure.query((): Settings => {
    return {
      general: getSettings('general'),
      appearance: getSettings('appearance'),
      keyboard: getSettings('keyboard'),
      permissions: getSettings('permissions'),
      browser: getSettings('browser'),
    };
  }),

  /** Merge a scoped partial patch into settings. The generic writer for every
   *  preference, so adding a setting needs no new procedure. */
  patch: publicProcedure.input(SettingsPatchSchema).mutation(({ input }) => {
    const conf = getSettings();
    for (const scope of Object.keys(input) as (keyof Settings)[]) {
      conf.set(scope, { ...getSettings(scope), ...input[scope] });
    }
    // Flipping browser control reconciles the managed browser MCP server so the
    // agent's browser tools appear/disappear without a restart.
    if (input.browser) void syncBrowserProvisioning();
  }),

  // "Launch at login" lives in the OS login items (the user can also flip it in
  // System Settings), so it's read/written there directly rather than in conf.
  openAtLogin: publicProcedure.query((): boolean => {
    return app.getLoginItemSettings().openAtLogin;
  }),

  setOpenAtLogin: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      app.setLoginItemSettings({ openAtLogin: input.enabled });
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
