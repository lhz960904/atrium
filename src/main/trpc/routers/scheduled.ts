import { PERMISSION_MODES } from '@shared/permissions';
import { z } from 'zod';
import type { UpdateScheduledTaskInput } from '../../agent/scheduled';
import { scheduledManager } from '../../agent/scheduled';
import { isRecurringCron } from '../../agent/scheduled/cron';
import { badRequest } from '../errors';
import { publicProcedure, router } from '../trpc';

/** Cap on simultaneously-enabled tasks — a runaway-automation backstop. */
const MAX_ACTIVE_TASKS = 20;

// `runAt` crosses the IPC boundary as epoch millis (no tRPC transformer here, so
// a Date input wouldn't survive) and is converted to a Date before the manager.
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

/** A recurring task needs a valid 5-field cron. Requiring exactly 5 fields caps
 *  granularity at one minute, which is the effective minimum interval. */
function checkCron(cron: string | null | undefined): string {
  const c = cron?.trim();
  if (!c) throw badRequest('A recurring task needs a cron expression.');
  if (!isRecurringCron(c)) throw badRequest(`Use a valid 5-field cron expression: ${c}`);
  return c;
}

function checkFuture(runAtMs: number | null | undefined): number {
  if (runAtMs == null) throw badRequest('A one-time task needs a run time.');
  if (runAtMs <= Date.now()) throw badRequest('The run time must be in the future.');
  return runAtMs;
}

/** Reject enabling a task past the active cap (excludes `excludeId` for updates). */
function assertUnderCap(excludeId?: string): void {
  const active = scheduledManager.listViews().filter((t) => t.enabled && t.id !== excludeId).length;
  if (active >= MAX_ACTIVE_TASKS) {
    throw badRequest(
      `Too many active scheduled tasks (max ${MAX_ACTIVE_TASKS}). Disable one first.`,
    );
  }
}

export const scheduledRouter = router({
  list: publicProcedure.query(() => scheduledManager.listViews()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => scheduledManager.getView(input.id)),

  runs: publicProcedure
    .input(z.object({ id: z.string(), limit: z.number().int().positive().max(100).optional() }))
    .query(({ input }) => scheduledManager.listRuns(input.id, input.limit)),

  create: publicProcedure.input(createInput).mutation(({ input }) => {
    let cronExpr: string | null = null;
    let runAt: Date | null = null;
    if (input.kind === 'once') runAt = new Date(checkFuture(input.runAt));
    else cronExpr = checkCron(input.cronExpr);
    if (input.enabled !== false) assertUnderCap();
    return scheduledManager.create({ ...input, cronExpr, runAt });
  }),

  update: publicProcedure.input(updateInput).mutation(({ input }) => {
    const { id, runAt, ...rest } = input;
    const patch: UpdateScheduledTaskInput = { ...rest };
    if (rest.cronExpr !== undefined && rest.cronExpr !== null)
      patch.cronExpr = checkCron(rest.cronExpr);
    if (runAt !== undefined) patch.runAt = runAt === null ? null : new Date(checkFuture(runAt));
    if (rest.enabled === true) assertUnderCap(id);
    return scheduledManager.update(id, patch);
  }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      if (input.enabled) assertUnderCap(input.id);
      return scheduledManager.setEnabled(input.id, input.enabled);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => scheduledManager.remove(input.id)),

  runNow: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    if (!scheduledManager.getView(input.id)) throw badRequest(`No scheduled task ${input.id}.`);
    // Fire-and-forget: a run drives a full agent turn (minutes), so don't hold
    // the request open. The bound thread + completion notification surface it.
    void scheduledManager.runNow(input.id);
    return { started: true };
  }),
});
