import { publicProcedure, router } from '../trpc';

export const systemRouter = router({
  /** Where the renderer's useChat transport should POST, plus its auth token. */
  chatEndpoint: publicProcedure.query(({ ctx }) => ({
    baseUrl: `http://127.0.0.1:${ctx.chatEndpoint.port}`,
    token: ctx.chatEndpoint.token,
  })),
});
