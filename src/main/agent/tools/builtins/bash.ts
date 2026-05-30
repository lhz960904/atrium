import { tool } from 'ai';
import { z } from 'zod';
import type { ToolCtx } from '../context';
import { middleTruncate } from '../output';

const BASH_MAX = 20_000;

export const bashTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Run a command in the workspace via a real shell (PTY). Use for any shell task — inspecting files, running scripts, system operations, and so on. Use absolute paths under the workspace.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are running this command, in short words. ALWAYS PROVIDE THIS FIRST.'),
      command: z.string().describe('The shell command to run.'),
    }),
    execute: async ({ command }) => {
      try {
        const { output, exitCode } = await ctx.sandbox.exec(command);
        // PTYs append \r\n noise; trim the tail before formatting.
        const text = output.trimEnd();
        const body = text === '' ? '(no output)' : middleTruncate(text, BASH_MAX);
        return exitCode === 0 ? body : `${body}\nExit Code: ${exitCode}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
