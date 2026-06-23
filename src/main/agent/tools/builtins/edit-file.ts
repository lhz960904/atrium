import { tool } from 'ai';
import { z } from 'zod';
import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { fsErrorMessage } from '../output';

/**
 * Replace an exact piece of a file's text with new text. old_string must be
 * unique unless replace_all is set, so an edit can't silently change the wrong
 * occurrence. Replacement is literal split/join (not String.replace) so `$`
 * sequences in new_string and regex metacharacters in old_string aren't
 * interpreted.
 */
export const editFileTool = (ctx: ToolCtx) =>
  tool({
    description: `Performs exact string replacement in a file. Read the file first so old_string matches exactly.

- old_string must match the file exactly, including whitespace and indentation, and be unique — the edit fails otherwise.
- replace_all: true replaces every occurrence instead.
- Prefer this over write_file for modifying a file. To create a new file, use write_file.`,
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are editing this file, in short words. ALWAYS PROVIDE THIS FIRST.'),
      path: z.string().describe('Absolute path to the file (under the workspace root).'),
      old_string: z.string().describe('The exact text to replace, copied verbatim from the file.'),
      new_string: z.string().describe('The text to replace it with.'),
      replace_all: z
        .boolean()
        .optional()
        .describe(
          'Replace every occurrence instead of requiring a unique match. Defaults to false.',
        ),
    }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      try {
        if (old_string === '')
          return 'Error: old_string is empty. To create a new file, use write_file.';
        if (old_string === new_string)
          return 'Error: old_string and new_string are identical — nothing to change.';

        const abs = resolveAbsolute(ctx.workspaceRoot, path);
        const content = await ctx.sandbox.readFile(abs);
        const count = content.split(old_string).length - 1;
        if (count === 0)
          return `Error: old_string not found in ${path}. It must match the file exactly, including whitespace and indentation.`;
        if (count > 1 && !replace_all)
          return `Error: old_string appears ${count} times in ${path}. Add surrounding context to make it unique, or set replace_all to true.`;

        const updated = replace_all
          ? content.split(old_string).join(new_string)
          : replaceFirst(content, old_string, new_string);
        await ctx.sandbox.writeFile(abs, updated, false);
        return count > 1 ? `Replaced ${count} occurrences in ${path}.` : `Edited ${path}.`;
      } catch (err) {
        return fsErrorMessage(err, path, 'editing');
      }
    },
  });

function replaceFirst(content: string, oldStr: string, newStr: string): string {
  const i = content.indexOf(oldStr);
  return content.slice(0, i) + newStr + content.slice(i + oldStr.length);
}
