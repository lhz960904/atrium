import { tool } from 'ai';
import { z } from 'zod';
import type { ToolCtx } from '../context';

export const bashOutputTool = (ctx: ToolCtx) =>
  tool({
    description:
      'Read new output from a background shell started with bash (run_in_background). Returns only the output produced since the last read. Optionally pass a regular expression to keep only matching lines.',
    inputSchema: z.object({
      shell_id: z
        .string()
        .describe('The shell id returned by bash run_in_background (e.g. bash_1).'),
      filter: z
        .string()
        .optional()
        .describe('A regular expression; only output lines matching it are returned.'),
    }),
    execute: async ({ shell_id, filter }) => {
      if (!ctx.bgShells) return 'Error: background shells are unavailable.';
      const r = ctx.bgShells.read(shell_id, filter);
      if (!r) return `Error: no background shell with id ${shell_id}.`;
      const status = r.running ? 'running' : `exited (code ${r.exitCode})`;
      const head = r.truncated ? '[earlier output truncated]\n' : '';
      const body = r.output === '' ? '(no new output)' : r.output;
      return `Shell ${shell_id} [${status}]\n${head}${body}`;
    },
  });
