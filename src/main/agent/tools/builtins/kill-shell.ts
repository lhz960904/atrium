import { tool } from 'ai';
import { z } from 'zod';
import type { ToolCtx } from '../context';

export const killShellTool = (ctx: ToolCtx) =>
  tool({
    description: 'Stop a background shell started with bash (run_in_background).',
    inputSchema: z.object({
      shell_id: z.string().describe('The shell id to stop (e.g. bash_1).'),
    }),
    execute: async ({ shell_id }) => {
      if (!ctx.bgShells) return 'Error: background shells are unavailable.';
      return ctx.bgShells.kill(shell_id)
        ? `Stopped background shell ${shell_id}.`
        : `Error: no background shell with id ${shell_id}.`;
    },
  });
