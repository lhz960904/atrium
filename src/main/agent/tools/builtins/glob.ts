import { tool } from 'ai';
import { z } from 'zod';
import { globFiles } from '../../sandbox/search';
import type { ToolCtx } from '../context';

export const globTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Find files and directories by path pattern across the workspace (e.g. "**/*.ts", "src/**", "blog-dashboard"). Returns matching paths — directories end with a trailing slash — skipping ignored dirs (node_modules, .git, …). Use it to check whether a file or folder exists. Prefer this over running find/ls through bash.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are searching, in short words. ALWAYS PROVIDE THIS FIRST.'),
      pattern: z
        .string()
        .describe('A glob pattern. Supports *, ** (across directories) and ?; no brace expansion.'),
      path: z
        .string()
        .optional()
        .describe('Subdirectory under the workspace to search. Defaults to the whole workspace.'),
    }),
    execute: async ({ pattern, path }) => {
      try {
        const { paths, truncated } = await globFiles(ctx.workspaceRoot, { pattern, path });
        if (paths.length === 0) return 'No files matched.';
        const head = truncated
          ? `${paths.length} files (truncated — narrow the pattern):`
          : `${paths.length} files:`;
        return `${head}\n${paths.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
