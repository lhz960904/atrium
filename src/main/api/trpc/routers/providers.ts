import {
  answerLogin,
  cancelLogin,
  logout,
  readLogin,
  startLogin,
} from '@main/agent/providers/oauth-login';
import {
  addableProviders,
  addProvider,
  createCustomProvider,
  ensureProviderRow,
  listProviders,
  mergeProviderConfig,
  NotADefinedProvider,
  ProviderIdTaken,
  removeCustomModel,
  removeProvider,
  setProviderEnabled,
  updateCustomProvider,
  upsertCustomModel,
} from '@main/agent/providers/store';
import {
  customModelSchema,
  customProviderIdSchema,
  customProviderSchema,
} from '@shared/custom-model';
import { shell } from 'electron';
import { z } from 'zod';
import { badRequest } from '../errors';
import { publicProcedure, router } from '../trpc';

const byId = z.object({ id: z.string() });

/** The store's refusals, in the code a client understands. */
function attempt<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ProviderIdTaken || error instanceof NotADefinedProvider) {
      throw badRequest(error.message);
    }
    throw error;
  }
}

export const providersRouter = router({
  list: publicProcedure.query(({ ctx }) => listProviders(ctx.db, ctx.credentials)),

  available: publicProcedure.query(({ ctx }) => addableProviders(ctx.db)),

  add: publicProcedure
    .input(byId)
    .mutation(({ ctx, input }) => attempt(() => addProvider(ctx.db, input.id))),

  remove: publicProcedure
    .input(byId)
    .mutation(({ ctx, input }) => removeProvider(ctx.db, input.id)),

  createCustomProvider: publicProcedure
    .input(z.object({ id: customProviderIdSchema, provider: customProviderSchema }))
    .mutation(({ ctx, input }) =>
      attempt(() => createCustomProvider(ctx.db, input.id, input.provider)),
    ),

  updateCustomProvider: publicProcedure
    .input(byId.extend({ provider: customProviderSchema }))
    .mutation(({ ctx, input }) =>
      attempt(() => updateCustomProvider(ctx.db, input.id, input.provider)),
    ),

  /**
   * Subscription login. `start` kicks the flow off and opens the browser; the
   * panel then polls `loginState` until it lands, answering `submitLogin` on
   * the rare path where the vendor wants a pasted code.
   */
  startLogin: publicProcedure.input(byId).mutation(({ ctx, input }) => {
    ensureProviderRow(ctx.db, input.id);
    return startLogin(input.id, (url) => void shell.openExternal(url));
  }),

  loginState: publicProcedure.input(byId).query(({ input }) => readLogin(input.id)),

  submitLogin: publicProcedure
    .input(byId.extend({ value: z.string() }))
    .mutation(({ input }) => ({ ok: answerLogin(input.id, input.value) })),

  cancelLogin: publicProcedure.input(byId).mutation(({ input }) => {
    cancelLogin(input.id);
  }),

  signOut: publicProcedure.input(byId).mutation(async ({ input }) => {
    await logout(input.id);
  }),

  setEnabled: publicProcedure
    .input(byId.extend({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) => setProviderEnabled(ctx.db, input.id, input.enabled)),

  updateConfig: publicProcedure
    .input(byId.extend({ partial: z.record(z.string(), z.unknown()) }))
    .mutation(({ ctx, input }) => mergeProviderConfig(ctx.db, input.id, input.partial)),

  /** Save an API key in the store requests resolve it from. */
  setCredentials: publicProcedure
    .input(byId.extend({ plaintext: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.credentials.modify(input.id, async () => ({
        type: 'api_key',
        key: input.plaintext,
      }));
    }),

  /**
   * The saved API key in plaintext, so the password field's eye toggle can
   * reveal it. Null when there is none, including when the provider holds an
   * OAuth token instead.
   */
  getCredentials: publicProcedure.input(byId).query(async ({ ctx, input }) => {
    const credential = await ctx.credentials.read(input.id);
    return credential?.type === 'api_key' ? (credential.key ?? null) : null;
  }),

  clearCredentials: publicProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await ctx.credentials.delete(input.id);
  }),

  upsertCustomModel: publicProcedure
    .input(byId.extend({ model: customModelSchema, previousId: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      attempt(() => upsertCustomModel(ctx.db, input.id, input.model, input.previousId)),
    ),

  removeCustomModel: publicProcedure
    .input(byId.extend({ modelId: z.string() }))
    .mutation(({ ctx, input }) =>
      attempt(() => removeCustomModel(ctx.db, input.id, input.modelId)),
    ),
});
