import { tool } from 'ai';
import { z } from 'zod';
import { resolveInWorkspace } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { headTruncate } from '../output';

const LIST_MAX = 20_000;

export const listDirTool = (ctx: ToolCtx) =>
  tool({
    description:
      'List the contents of a directory up to 2 levels deep (junk like .git / node_modules is skipped).',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are listing this directory, in short words. ALWAYS PROVIDE THIS FIRST.'),
      path: z
        .string()
        .optional()
        .describe(
          'Absolute directory path (under the workspace root). Defaults to the workspace root.',
        ),
    }),
    execute: async ({ path }) => {
      const target = path ?? '.';
      try {
        const abs = resolveInWorkspace(ctx.workspaceRoot, target);
        const entries = await ctx.sandbox.list(abs);
        if (entries.length === 0) return '(empty)';
        return headTruncate(
          entries.join('\n'),
          LIST_MAX,
          'Use a more specific path to see fewer results',
        );
      } catch (err) {
        return listError(err, target);
      }
    },
  });

function listError(err: unknown, path: string): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return `Error: Directory not found: ${path}`;
  if (code === 'EACCES') return `Error: Permission denied: ${path}`;
  if (code === 'ENOTDIR') return `Error: Not a directory: ${path}`;
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}
