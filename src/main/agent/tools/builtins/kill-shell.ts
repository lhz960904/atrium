import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';

export const killShellTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'kill_shell',
    label: 'Stop shell',
    description: 'Stop a background shell started with bash (run_in_background).',
    parameters: Type.Object({
      shell_id: Type.String({ description: 'The shell id to stop (e.g. bash_1).' }),
    }),
    execute: async (_id, { shell_id }) => {
      if (!ctx.bgShells) throw new Error('background shells are unavailable.');
      if (!ctx.bgShells.kill(shell_id)) throw new Error(`no background shell with id ${shell_id}.`);
      return textResult(`Stopped background shell ${shell_id}.`);
    },
  });
