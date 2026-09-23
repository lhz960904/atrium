import {
  assignableTools,
  createSubagent,
  listSubagents,
  removeSubagent,
  updateSubagent,
} from '@main/agent/subagent/defs';
import { getDb } from '@main/db';
import { z } from 'zod';
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

export const subagentsRouter = router({
  list: publicProcedure.query(() => listSubagents(getDb())),

  assignableTools: publicProcedure.query(() => assignableTools()),

  create: publicProcedure
    .input(fields)
    .mutation(({ input }) => ({ id: createSubagent(getDb(), input) })),

  update: publicProcedure.input(fields.extend({ id: z.string() })).mutation(({ input }) => {
    const { id, ...rest } = input;
    updateSubagent(getDb(), id, rest);
  }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => removeSubagent(getDb(), input.id)),
});
