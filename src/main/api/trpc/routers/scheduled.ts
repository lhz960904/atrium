import { scheduledManager } from '@main/agent/automation';
import { PERMISSION_MODES } from '@shared/permissions';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

// `runAt` crosses the IPC boundary as epoch millis (no tRPC transformer here, so
// a Date input wouldn't survive) and is converted before the manager sees it.
const createInput = z.object({
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  kind: z.enum(['recurring', 'once']),
  cronExpr: z.string().trim().nullish(),
  runAt: z.number().int().nullish(),
  timezone: z.string().min(1),
  enabled: z.boolean().optional(),
  projectId: z.string().nullish(),
  providerId: z.string().nullish(),
  modelId: z.string().nullish(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  catchUpPolicy: z.enum(['fire_once', 'skip']).optional(),
});

const updateInput = createInput.partial().extend({ id: z.string() });

const asDate = (runAt: number | null | undefined) => (runAt == null ? runAt : new Date(runAt));

export const scheduledRouter = router({
  list: publicProcedure.query(() => scheduledManager.listViews()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => scheduledManager.getView(input.id)),

  runs: publicProcedure
    .input(z.object({ id: z.string(), limit: z.number().int().positive().max(100).optional() }))
    .query(({ input }) => scheduledManager.listRuns(input.id, input.limit)),

  create: publicProcedure
    .input(createInput)
    .mutation(({ input }) => scheduledManager.create({ ...input, runAt: asDate(input.runAt) })),

  update: publicProcedure.input(updateInput).mutation(({ input }) => {
    const { id, runAt, ...rest } = input;
    return scheduledManager.update(id, {
      ...rest,
      ...(runAt !== undefined && { runAt: asDate(runAt) }),
    });
  }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => scheduledManager.setEnabled(input.id, input.enabled)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => scheduledManager.remove(input.id)),

  runNow: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => scheduledManager.requestRun(input.id)),
});
