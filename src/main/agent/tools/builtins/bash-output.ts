import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';

export const bashOutputTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'bash_output',
    label: 'Read shell output',
    description:
      'Read new output from a background shell started with bash (run_in_background). Returns only the output produced since the last read. Optionally pass a regular expression to keep only matching lines.',
    parameters: Type.Object({
      shell_id: Type.String({
        description: 'The shell id returned by bash run_in_background (e.g. bash_1).',
      }),
      filter: Type.Optional(
        Type.String({
          description: 'A regular expression; only output lines matching it are returned.',
        }),
      ),
    }),
    execute: async (_id, { shell_id, filter }) => {
      if (!ctx.bgShells) throw new Error('background shells are unavailable.');
      const r = ctx.bgShells.read(shell_id, filter);
      if (!r) throw new Error(`no background shell with id ${shell_id}.`);
      const status = r.running ? 'running' : `exited (code ${r.exitCode})`;
      const head = r.truncated ? '[earlier output truncated]\n' : '';
      const body = r.output === '' ? '(no new output)' : r.output;
      return textResult(`Shell ${shell_id} [${status}]\n${head}${body}`);
    },
  });
