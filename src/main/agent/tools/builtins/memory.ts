import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { MEMORY_INDEX, memoryDir } from '../../memory/paths';
import { deleteMemory, fileName, MEMORY_TYPES, writeMemory } from '../../memory/store';
import type { ToolCtx } from '../context';

const DESCRIPTION = `Durable memory that persists across sessions, so you don't depend on the user repeating themselves.
Record a memory when you learn something that should change how you act in future sessions: a user preference you keep getting corrected on, a hard-won project fact, a reusable command or workflow, a decision and why it was made. Before writing, ask: will a future session plausibly act better because of this? If not, don't write it. Do NOT record transient task state (use todo_write), facts you can re-derive, generic advice, or secrets.
Keep what's stored honest: if a memory here is now wrong — it contradicts the user's instructions, or the project changed and made it stale — delete or rewrite it.
scope=project: facts specific to this workspace. scope=global: facts true across all the user's projects.
The name is the key — writing an existing name replaces that memory. The MEMORY.md index is maintained for you; read it with view (no name) to see what's stored, then view a name for the full entry.`;

export const memoryInputSchema = z.object({
  command: z.enum(['view', 'write', 'delete']),
  scope: z.enum(['project', 'global']).default('project'),
  name: z
    .string()
    .optional()
    .describe(
      "the memory's short title; identifies it for view/write/delete. Omit on view to read the index.",
    ),
  description: z
    .string()
    .optional()
    .describe('one-line summary shown in the index (required on write)'),
  type: z
    .enum(MEMORY_TYPES)
    .optional()
    .describe(
      'preference = how the user likes to work; project = a fact/convention/decision about this codebase; reference = a pointer to a file, url, or command (required on write)',
    ),
  body: z
    .string()
    .optional()
    .describe('the memory itself — what to remember and why it matters (required on write)'),
});

type MemoryCommand = {
  command: 'view' | 'write' | 'delete';
  name?: string;
  description?: string;
  type?: (typeof MEMORY_TYPES)[number];
  body?: string;
};

/**
 * Run a view/write/delete against a fixed memory dir. Shared by the model-facing
 * tool (dir resolved from scope) and the dream agent (its scope's dir).
 */
export async function dispatchMemory(dir: string, cmd: MemoryCommand): Promise<string> {
  await mkdir(dir, { recursive: true });
  if (cmd.command === 'view') {
    return cmd.name
      ? readOr(join(dir, fileName(cmd.name)), `no memory named "${cmd.name}"`)
      : readOr(join(dir, MEMORY_INDEX), '# Memory\n');
  }
  if (cmd.command === 'write') {
    const { name, description, type, body } = cmd;
    if (!name || !description || !type || !body) {
      throw new Error('write requires name, description, type, and body');
    }
    await writeMemory(dir, { name, description, type, body });
    return `saved memory "${name}"`;
  }
  if (!cmd.name) throw new Error('delete requires name');
  await deleteMemory(dir, cmd.name);
  return `deleted memory "${cmd.name}"`;
}

export function memoryTool(ctx: ToolCtx) {
  return tool({
    description: DESCRIPTION,
    inputSchema: memoryInputSchema,
    execute: ({ command, scope, name, description, type, body }) =>
      dispatchMemory(memoryDir(scope, ctx.workspaceRoot), {
        command,
        name,
        description,
        type,
        body,
      }),
  });
}

/** The memory tool bound to one dir, given to the dream agent (no scope to pick). */
export function memoryDirTool(dir: string) {
  return tool({
    description:
      'View, write, and delete memories in this directory. Writing an existing name replaces it; the index is maintained for you.',
    inputSchema: memoryInputSchema.omit({ scope: true }),
    execute: (input) => dispatchMemory(dir, input),
  });
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
}
