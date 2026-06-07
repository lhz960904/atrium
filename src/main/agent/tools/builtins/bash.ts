import { tool } from 'ai';
import { z } from 'zod';
import type { ToolCtx } from '../context';
import { middleTruncate } from '../output';

const BASH_MAX = 20_000;

export const bashTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Run a command in the workspace via a real shell. Use for any shell task — inspecting files, running scripts, system operations, and so on. Use absolute paths under the workspace. For a long-running command that never returns on its own (a dev server, file watcher, `tail -f`), set run_in_background — a foreground command would hang until it times out.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are running this command, in short words. ALWAYS PROVIDE THIS FIRST.'),
      command: z.string().describe('The shell command to run.'),
      run_in_background: z
        .boolean()
        .optional()
        .describe(
          'Run as a long-running background shell. Returns a shell id immediately; read its output with bash_output and stop it with kill_shell.',
        ),
    }),
    execute: async ({ command, run_in_background }) => {
      if (run_in_background) {
        if (!ctx.bgShells) return 'Error: background shells are unavailable.';
        const shellId = ctx.bgShells.start(command, ctx.workspaceRoot);
        return `Started background shell ${shellId}. Read its output with bash_output and stop it with kill_shell.`;
      }
      try {
        const { output, exitCode } = await ctx.sandbox.exec(command);
        const text = output.trimEnd();
        const body = text === '' ? '(no output)' : middleTruncate(text, BASH_MAX);
        return exitCode === 0 ? body : `${body}\nExit Code: ${exitCode}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
