import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { MEMORY_INDEX, memoryDir } from '../../memory/paths';
import { deleteMemory, fileName, MEMORY_TYPES, writeMemory } from '../../memory/store';
import type { ToolCtx } from '../context';

const DESCRIPTION = `Durable memory that persists across sessions, so you don't depend on the user repeating themselves.
Record a memory when you learn something that should change how you act in future sessions: a user preference you keep getting corrected on, a hard-won project fact, a reusable command or workflow, a decision and why it was made. Before writing, ask: will a future session plausibly act better because of this? If not, don't write it. Do NOT record transient task state (use todo_write), facts you can re-derive, generic advice, or secrets.
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

export function memoryTool(ctx: ToolCtx) {
  return tool({
    description: DESCRIPTION,
    inputSchema: memoryInputSchema,
    async execute({ command, scope, name, description, type, body }) {
      const dir = memoryDir(scope, ctx.workspaceRoot);
      await mkdir(dir, { recursive: true });
      if (command === 'view') {
        return name
          ? readOr(join(dir, fileName(name)), `no memory named "${name}"`)
          : readOr(join(dir, MEMORY_INDEX), '# Memory\n');
      }
      if (command === 'write') {
        if (!name || !description || !type || !body) {
          throw new Error('write requires name, description, type, and body');
        }
        await writeMemory(dir, { name, description, type, body });
        return `saved memory "${name}" (${scope})`;
      }
      if (!name) throw new Error('delete requires name');
      await deleteMemory(dir, name);
      return `deleted memory "${name}" (${scope})`;
    },
  });
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
}
