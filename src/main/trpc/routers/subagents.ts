import { randomUUID } from 'node:crypto';
import { TOOL_NAMES } from '@shared/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { BUILTIN_SUBAGENTS, SUBAGENT_DENIED_TOOLS } from '../../agent/subagent/defs';
import { subagents } from '../../db/schema';
import { conflict } from '../errors';
import { publicProcedure, router } from '../trpc';

/** Unified row for the settings list: built-ins (read-only) + custom (editable). */
type SubagentView = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolAllow: string[] | null;
  toolDeny: string[] | null;
  providerId: string | null;
  modelId: string | null;
  builtin: boolean;
};

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
  /** Built-ins (id = name, read-only) followed by the custom rows. */
  list: publicProcedure.query(({ ctx }): SubagentView[] => {
    const builtins: SubagentView[] = Object.values(BUILTIN_SUBAGENTS).map((s) => ({
      id: s.name,
      name: s.name,
      description: s.description,
      systemPrompt: s.systemPrompt,
      toolAllow: s.toolAllow ?? null,
      toolDeny: s.toolDeny ?? null,
      providerId: s.providerId ?? null,
      modelId: s.modelId ?? null,
      builtin: true,
    }));
    const custom: SubagentView[] = ctx.db
      .select()
      .from(subagents)
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        systemPrompt: r.systemPrompt,
        toolAllow: r.toolAllow as string[] | null,
        toolDeny: r.toolDeny as string[] | null,
        providerId: r.providerId,
        modelId: r.modelId,
        builtin: false,
      }));
    return [...builtins, ...custom];
  }),

  /** Tools a custom subagent may be granted (everything minus the never-allowed set). */
  assignableTools: publicProcedure.query(() =>
    TOOL_NAMES.filter((t) => !SUBAGENT_DENIED_TOOLS.has(t)),
  ),

  create: publicProcedure.input(fields).mutation(({ ctx, input }) => {
    assertNameFree(ctx.db, input.name);
    const id = randomUUID();
    const now = new Date();
    ctx.db
      .insert(subagents)
      .values({ id, ...input, createdAt: now, updatedAt: now })
      .run();
    return { id };
  }),

  update: publicProcedure.input(fields.extend({ id: z.string() })).mutation(({ ctx, input }) => {
    const { id, ...rest } = input;
    assertNameFree(ctx.db, rest.name, id);
    ctx.db
      .update(subagents)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(subagents.id, id))
      .run();
  }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.delete(subagents).where(eq(subagents.id, input.id)).run();
  }),
});

/** Reject a name that collides with a built-in or another custom subagent. */
function assertNameFree(db: import('../../db').Db, name: string, excludeId?: string): void {
  if (BUILTIN_SUBAGENTS[name]) {
    throw conflict(`'${name}' is a built-in subagent name.`);
  }
  const existing = db
    .select({ id: subagents.id })
    .from(subagents)
    .where(eq(subagents.name, name))
    .get();
  if (existing && existing.id !== excludeId) {
    throw conflict(`A subagent named '${name}' already exists.`);
  }
}
