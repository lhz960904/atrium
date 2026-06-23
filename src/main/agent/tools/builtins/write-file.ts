import { tool } from 'ai';
import { z } from 'zod';
import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { fsErrorMessage } from '../output';

export const writeFileTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Write text content to a file. Overwrites by default; set append to add to the end instead. Parent directories are created as needed.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are writing this file, in short words. ALWAYS PROVIDE THIS FIRST.'),
      path: z.string().describe('Absolute path to the file (under the workspace root).'),
      content: z.string().describe('The full content to write.'),
      append: z
        .boolean()
        .optional()
        .describe('Append to the end instead of overwriting. Defaults to false.'),
    }),
    execute: async ({ path, content, append }) => {
      try {
        const abs = resolveAbsolute(ctx.workspaceRoot, path);
        const { bytes } = await ctx.sandbox.writeFile(abs, content, append ?? false);
        return `Wrote ${bytes} bytes to ${path}.`;
      } catch (err) {
        return fsErrorMessage(err, path, 'writing to');
      }
    },
  });
