import { tool } from 'ai';
import { z } from 'zod';
import { grepFiles } from '../../sandbox/search';
import type { ToolCtx } from '../context';

export const grepTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Search file contents for a regular expression across the workspace. Returns matching file:line: text. Case-insensitive by default; skips ignored directories (node_modules, .git, …) and binary files. Prefer this over running grep/rg through bash — it is consistent across platforms and never floods the output.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are searching, in short words. ALWAYS PROVIDE THIS FIRST.'),
      pattern: z
        .string()
        .describe('The regular expression to search for (or plain text with literal set).'),
      path: z
        .string()
        .optional()
        .describe('Subdirectory under the workspace to search. Defaults to the whole workspace.'),
      glob: z
        .string()
        .optional()
        .describe('Only search files whose path matches this glob, e.g. "src/**/*.ts".'),
      literal: z
        .boolean()
        .optional()
        .describe('Treat pattern as plain text instead of a regex. Defaults to false.'),
      case_sensitive: z
        .boolean()
        .optional()
        .describe('Match case. Defaults to false (case-insensitive).'),
    }),
    execute: async ({ pattern, path, glob, literal, case_sensitive }) => {
      try {
        const { matches, truncated } = await grepFiles(ctx.workspaceRoot, {
          pattern,
          path,
          glob,
          literal,
          caseSensitive: case_sensitive,
        });
        if (matches.length === 0) return 'No matches.';
        const head = truncated
          ? `${matches.length} matches (truncated — narrow the pattern or add a glob):`
          : `${matches.length} matches:`;
        return `${head}\n${matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
