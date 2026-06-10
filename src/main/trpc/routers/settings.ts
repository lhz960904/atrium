import { PERMISSION_MODES, type PermissionMode } from '@shared/permissions';
import type { TrustRule } from '@shared/permissions/rules';
import { z } from 'zod';
import { DEFAULTS, getSettings, type SelectedModel } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

const ruleInput = z.object({ tool: z.string(), matcher: z.string() });
const sameRule = (a: TrustRule, b: TrustRule): boolean =>
  a.tool === b.tool && a.matcher === b.matcher;

export const settingsRouter = router({
  /** The persisted default chat model, or null if none chosen yet. */
  selectedModel: publicProcedure.query((): SelectedModel | null => {
    return getSettings().get('selectedModel', DEFAULTS.selectedModel);
  }),

  setSelectedModel: publicProcedure
    .input(z.object({ providerId: z.string(), modelId: z.string() }))
    .mutation(({ input }) => {
      getSettings().set('selectedModel', input);
    }),

  /** UI language preference ('system' follows the OS locale). */
  language: publicProcedure.query((): 'system' | 'en' | 'zh' => {
    return getSettings().get('language', DEFAULTS.language);
  }),

  setLanguage: publicProcedure
    .input(z.object({ language: z.enum(['system', 'en', 'zh']) }))
    .mutation(({ input }) => {
      getSettings().set('language', input.language);
    }),

  /** The active tool-permission mode (default / auto-review / full-access). */
  permissionMode: publicProcedure.query((): PermissionMode => {
    return getSettings().get('permissionMode', DEFAULTS.permissionMode);
  }),

  setPermissionMode: publicProcedure
    .input(z.object({ mode: z.enum(PERMISSION_MODES) }))
    .mutation(({ input }) => {
      getSettings().set('permissionMode', input.mode);
    }),

  /** The tool-permission trust list ("always allow" entries). */
  trustRules: publicProcedure.query((): TrustRule[] => {
    return getSettings().get('trustRules', DEFAULTS.trustRules);
  }),

  addTrustRule: publicProcedure.input(ruleInput).mutation(({ input }) => {
    const rule = input as TrustRule;
    const cur = getSettings().get('trustRules', DEFAULTS.trustRules);
    if (!cur.some((r) => sameRule(r, rule))) getSettings().set('trustRules', [...cur, rule]);
  }),

  deleteTrustRule: publicProcedure.input(ruleInput).mutation(({ input }) => {
    const rule = input as TrustRule;
    const cur = getSettings().get('trustRules', DEFAULTS.trustRules);
    getSettings().set(
      'trustRules',
      cur.filter((r) => !sameRule(r, rule)),
    );
  }),
});
