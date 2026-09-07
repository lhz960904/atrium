import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';
import { middleTruncate } from '../output';

const BASH_MAX = 20_000;

export const bashTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'bash',
    label: 'Run command',
    description:
      'Run a command in the workspace via a real shell. Use for any shell task — inspecting files, running scripts, system operations, and so on. Use absolute paths under the workspace. For a long-running command that never returns on its own (a dev server, file watcher, `tail -f`), set run_in_background — a foreground command would hang until it times out.',
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are running this command, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      command: Type.String({ description: 'The shell command to run.' }),
      run_in_background: Type.Optional(
        Type.Boolean({
          description:
            'Run as a long-running background shell. Returns a shell id immediately; read its output with bash_output and stop it with kill_shell.',
        }),
      ),
    }),
    execute: async (_id, { command, run_in_background }, signal) => {
      if (run_in_background) {
        if (!ctx.bgShells) throw new Error('background shells are unavailable.');
        const shellId = ctx.bgShells.start(command, ctx.workspaceRoot);
        return textResult(
          `Started background shell ${shellId}. Read its output with bash_output and stop it with kill_shell.`,
        );
      }
      const { output, exitCode } = await ctx.sandbox.exec(command, { signal });
      const text = output.trimEnd();
      const body = text === '' ? '(no output)' : middleTruncate(text, BASH_MAX);
      return textResult(exitCode === 0 ? body : `${body}\nExit Code: ${exitCode}`);
    },
  });
