import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';
import { fsError, headTruncate } from '../output';

const READ_MAX = 50_000;

export const readFileTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'read_file',
    label: 'Read file',
    description:
      'Read the contents of a text file (documents, notes, data, config, code — anything text-based).',
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are reading this file, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      path: Type.String({ description: 'Absolute path to the file (under the workspace root).' }),
      start_line: Type.Optional(
        Type.Integer({
          description: 'Optional 1-indexed start line (inclusive). Use with end_line for a range.',
        }),
      ),
      end_line: Type.Optional(
        Type.Integer({
          description: 'Optional 1-indexed end line (inclusive). Use with start_line for a range.',
        }),
      ),
    }),
    execute: async (_id, { path, start_line, end_line }) => {
      const abs = resolveAbsolute(ctx.workspaceRoot, path);
      let content: string;
      try {
        content = await ctx.sandbox.readFile(abs);
      } catch (err) {
        throw fsError(err, path, 'reading');
      }
      if (content === '') return textResult('(empty)');
      if (start_line != null && end_line != null) {
        content = content
          .split('\n')
          .slice(start_line - 1, end_line)
          .join('\n');
      }
      return textResult(
        headTruncate(content, READ_MAX, 'Use start_line/end_line to read a specific range'),
      );
    },
  });
