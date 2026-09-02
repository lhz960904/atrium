import { grepFiles } from '../../sandbox/search';
import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';

export const grepTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'grep',
    label: 'Search contents',
    description:
      'Search file contents for a regular expression across the workspace. Returns matching file:line: text. Case-insensitive by default; skips ignored directories (node_modules, .git, …) and binary files. Prefer this over running grep/rg through bash — it is consistent across platforms and never floods the output.',
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are searching, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      pattern: Type.String({
        description: 'The regular expression to search for (or plain text with literal set).',
      }),
      path: Type.Optional(
        Type.String({
          description:
            'Subdirectory under the workspace to search. Defaults to the whole workspace.',
        }),
      ),
      glob: Type.Optional(
        Type.String({
          description: 'Only search files whose path matches this glob, e.g. "src/**/*.ts".',
        }),
      ),
      literal: Type.Optional(
        Type.Boolean({
          description: 'Treat pattern as plain text instead of a regex. Defaults to false.',
        }),
      ),
      case_sensitive: Type.Optional(
        Type.Boolean({ description: 'Match case. Defaults to false (case-insensitive).' }),
      ),
    }),
    execute: async (_id, { pattern, path, glob, literal, case_sensitive }) => {
      const { matches, truncated } = await grepFiles(ctx.workspaceRoot, {
        pattern,
        path,
        glob,
        literal,
        caseSensitive: case_sensitive,
      });
      if (matches.length === 0) return textResult('No matches.');
      const head = truncated
        ? `${matches.length} matches (truncated — narrow the pattern or add a glob):`
        : `${matches.length} matches:`;
      return textResult(
        `${head}\n${matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n')}`,
      );
    },
  });
