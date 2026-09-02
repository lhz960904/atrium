import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';
import { headTruncate } from '../output';

const LIST_MAX = 20_000;

export const listDirTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'list_dir',
    label: 'List directory',
    description:
      'List the contents of a directory up to 2 levels deep (junk like .git / node_modules is skipped).',
    parameters: Type.Object({
      description: Type.String({
        description:
          'Why you are listing this directory, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      path: Type.Optional(
        Type.String({
          description:
            'Absolute directory path (under the workspace root). Defaults to the workspace root.',
        }),
      ),
    }),
    execute: async (_id, { path }) => {
      const target = path ?? '.';
      let entries: string[];
      try {
        entries = await ctx.sandbox.list(resolveAbsolute(ctx.workspaceRoot, target));
      } catch (err) {
        throw listError(err, target);
      }
      if (entries.length === 0) return textResult('(empty)');
      return textResult(
        headTruncate(entries.join('\n'), LIST_MAX, 'Use a more specific path to see fewer results'),
      );
    },
  });

function listError(err: unknown, path: string): Error {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return new Error(`Directory not found: ${path}`);
  if (code === 'EACCES') return new Error(`Permission denied: ${path}`);
  if (code === 'ENOTDIR') return new Error(`Not a directory: ${path}`);
  return err instanceof Error ? err : new Error(String(err));
}
