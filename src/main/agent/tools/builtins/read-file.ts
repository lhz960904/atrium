import { tool } from 'ai';
import { z } from 'zod';
import { resolveInWorkspace } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { fsErrorMessage, headTruncate } from '../output';

const READ_MAX = 50_000;

export const readFileTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Read the contents of a text file (documents, notes, data, config, code — anything text-based).',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are reading this file, in short words. ALWAYS PROVIDE THIS FIRST.'),
      path: z.string().describe('Absolute path to the file (under the workspace root).'),
      start_line: z
        .number()
        .int()
        .optional()
        .describe('Optional 1-indexed start line (inclusive). Use with end_line for a range.'),
      end_line: z
        .number()
        .int()
        .optional()
        .describe('Optional 1-indexed end line (inclusive). Use with start_line for a range.'),
    }),
    execute: async ({ path, start_line, end_line }) => {
      try {
        const abs = resolveInWorkspace(ctx.workspaceRoot, path);
        let content = await ctx.sandbox.readFile(abs);
        if (content === '') return '(empty)';
        if (start_line != null && end_line != null) {
          content = content
            .split('\n')
            .slice(start_line - 1, end_line)
            .join('\n');
        }
        return headTruncate(content, READ_MAX, 'Use start_line/end_line to read a specific range');
      } catch (err) {
        return fsErrorMessage(err, path, 'reading');
      }
    },
  });
