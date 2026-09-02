import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';
import { fsError } from '../output';

export const writeFileTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'write_file',
    label: 'Write file',
    description:
      'Write text content to a file. Overwrites by default; set append to add to the end instead. Parent directories are created as needed.',
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are writing this file, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      path: Type.String({ description: 'Absolute path to the file (under the workspace root).' }),
      content: Type.String({ description: 'The full content to write.' }),
      append: Type.Optional(
        Type.Boolean({
          description: 'Append to the end instead of overwriting. Defaults to false.',
        }),
      ),
    }),
    execute: async (_id, { path, content, append }) => {
      try {
        const abs = resolveAbsolute(ctx.workspaceRoot, path);
        const { bytes } = await ctx.sandbox.writeFile(abs, content, append ?? false);
        return textResult(`Wrote ${bytes} bytes to ${path}.`);
      } catch (err) {
        throw fsError(err, path, 'writing to');
      }
    },
  });
