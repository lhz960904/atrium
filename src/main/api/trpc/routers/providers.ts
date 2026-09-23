import {
  answerLogin,
  cancelLogin,
  logout,
  readLogin,
  startLogin,
} from '@main/agent/providers/oauth-login';
import { credentialStore } from '@main/agent/providers/registry';
import {
  addableProviders,
  addProvider,
  createCustomProvider,
  ensureProviderRow,
  listProviders,
  mergeProviderConfig,
  readApiKey,
  removeCustomModel,
  removeProvider,
  saveApiKey,
  setProviderEnabled,
  updateCustomProvider,
  upsertCustomModel,
} from '@main/agent/providers/store';
import { getDb } from '@main/db';
import {
  customModelSchema,
  customProviderIdSchema,
  customProviderSchema,
} from '@shared/custom-model';
import { shell } from 'electron';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const byId = z.object({ id: z.string() });

export const providersRouter = router({
  list: publicProcedure.query(() => listProviders(getDb(), credentialStore())),

  available: publicProcedure.query(() => addableProviders(getDb())),

  add: publicProcedure.input(byId).mutation(({ input }) => addProvider(getDb(), input.id)),

  remove: publicProcedure.input(byId).mutation(({ input }) => removeProvider(getDb(), input.id)),

  createCustomProvider: publicProcedure
    .input(z.object({ id: customProviderIdSchema, provider: customProviderSchema }))
    .mutation(({ input }) => createCustomProvider(getDb(), input.id, input.provider)),

  updateCustomProvider: publicProcedure
    .input(byId.extend({ provider: customProviderSchema }))
    .mutation(({ input }) => updateCustomProvider(getDb(), input.id, input.provider)),

  /**
   * Subscription login. `start` kicks the flow off and opens the browser; the
   * panel then polls `loginState` until it lands, answering `submitLogin` on
   * the rare path where the vendor wants a pasted code.
   */
  startLogin: publicProcedure.input(byId).mutation(({ input }) => {
    ensureProviderRow(getDb(), input.id);
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
    .mutation(({ input }) => setProviderEnabled(getDb(), input.id, input.enabled)),

  updateConfig: publicProcedure
    .input(byId.extend({ partial: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => mergeProviderConfig(getDb(), input.id, input.partial)),

  setCredentials: publicProcedure
    .input(byId.extend({ plaintext: z.string() }))
    .mutation(({ input }) => saveApiKey(credentialStore(), input.id, input.plaintext)),

  getCredentials: publicProcedure
    .input(byId)
    .query(({ input }) => readApiKey(credentialStore(), input.id)),

  clearCredentials: publicProcedure.input(byId).mutation(async ({ input }) => {
    await credentialStore().delete(input.id);
  }),

  upsertCustomModel: publicProcedure
    .input(byId.extend({ model: customModelSchema, previousId: z.string().optional() }))
    .mutation(({ input }) => upsertCustomModel(getDb(), input.id, input.model, input.previousId)),

  removeCustomModel: publicProcedure
    .input(byId.extend({ modelId: z.string() }))
    .mutation(({ input }) => removeCustomModel(getDb(), input.id, input.modelId)),
});
