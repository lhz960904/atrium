import {
  assignableTools,
  createSubagent,
  listSubagents,
  removeSubagent,
  SubagentNameTaken,
  updateSubagent,
} from '@main/agent/subagent/defs';
import { getDb } from '@main/db';
import { z } from 'zod';
import { conflict } from '../errors';
import { publicProcedure, router } from '../trpc';

const fields = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  systemPrompt: z.string(),
  toolAllow: z.array(z.string()).nullable(),
  toolDeny: z.array(z.string()).nullable(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
});

function attempt<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SubagentNameTaken) throw conflict(error.message);
    throw error;
  }
}

export const subagentsRouter = router({
  list: publicProcedure.query(() => listSubagents(getDb())),

  assignableTools: publicProcedure.query(() => assignableTools()),

  create: publicProcedure
    .input(fields)
    .mutation(({ input }) => attempt(() => ({ id: createSubagent(getDb(), input) }))),

  update: publicProcedure.input(fields.extend({ id: z.string() })).mutation(({ input }) => {
    const { id, ...rest } = input;
    attempt(() => updateSubagent(getDb(), id, rest));
  }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => removeSubagent(getDb(), input.id)),
});
