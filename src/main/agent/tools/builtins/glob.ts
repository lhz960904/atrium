import { globFiles } from '../../sandbox/search';
import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';

export const globTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'glob',
    label: 'Find files',
    description:
      'Find files and directories by path pattern across the workspace (e.g. "**/*.ts", "src/**", "blog-dashboard"). Returns matching paths — directories end with a trailing slash — skipping ignored dirs (node_modules, .git, …). Use it to check whether a file or folder exists. Prefer this over running find/ls through bash.',
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are searching, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      pattern: Type.String({
        description:
          'A glob pattern. Supports *, ** (across directories) and ?; no brace expansion.',
      }),
      path: Type.Optional(
        Type.String({
          description:
            'Subdirectory under the workspace to search. Defaults to the whole workspace.',
        }),
      ),
    }),
    execute: async (_id, { pattern, path }) => {
      const { paths, truncated } = await globFiles(ctx.workspaceRoot, { pattern, path });
      if (paths.length === 0) return textResult('No files matched.');
      const head = truncated
        ? `${paths.length} files (truncated — narrow the pattern):`
        : `${paths.length} files:`;
      return textResult(`${head}\n${paths.join('\n')}`);
    },
  });
