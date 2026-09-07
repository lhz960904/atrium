import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { defineTool, Type, textResult } from '../define';
import { fsError } from '../output';

/**
 * Replace an exact piece of a file's text with new text. old_string must be
 * unique unless replace_all is set, so an edit can't silently change the wrong
 * occurrence. Replacement is literal split/join (not String.replace) so `$`
 * sequences in new_string and regex metacharacters in old_string aren't
 * interpreted.
 */
export const editFileTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'edit_file',
    label: 'Edit file',
    description: `Performs exact string replacement in a file. Read the file first so old_string matches exactly.

- old_string must match the file exactly, including whitespace and indentation, and be unique — the edit fails otherwise.
- replace_all: true replaces every occurrence instead.
- Prefer this over write_file for modifying a file. To create a new file, use write_file.`,
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are editing this file, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      path: Type.String({ description: 'Absolute path to the file (under the workspace root).' }),
      old_string: Type.String({
        description: 'The exact text to replace, copied verbatim from the file.',
      }),
      new_string: Type.String({ description: 'The text to replace it with.' }),
      replace_all: Type.Optional(
        Type.Boolean({
          description:
            'Replace every occurrence instead of requiring a unique match. Defaults to false.',
        }),
      ),
    }),
    execute: async (_id, { path, old_string, new_string, replace_all }) => {
      if (old_string === '')
        throw new Error('old_string is empty. To create a new file, use write_file.');
      if (old_string === new_string)
        throw new Error('old_string and new_string are identical — nothing to change.');

      const abs = resolveAbsolute(ctx.workspaceRoot, path);
      let content: string;
      try {
        content = await ctx.sandbox.readFile(abs);
      } catch (err) {
        throw fsError(err, path, 'editing');
      }
      const count = content.split(old_string).length - 1;
      if (count === 0)
        throw new Error(
          `old_string not found in ${path}. It must match the file exactly, including whitespace and indentation.`,
        );
      if (count > 1 && !replace_all)
        throw new Error(
          `old_string appears ${count} times in ${path}. Add surrounding context to make it unique, or set replace_all to true.`,
        );

      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : replaceFirst(content, old_string, new_string);
      try {
        await ctx.sandbox.writeFile(abs, updated, false);
      } catch (err) {
        throw fsError(err, path, 'editing');
      }
      return textResult(
        count > 1 ? `Replaced ${count} occurrences in ${path}.` : `Edited ${path}.`,
      );
    },
  });

function replaceFirst(content: string, oldStr: string, newStr: string): string {
  const i = content.indexOf(oldStr);
  return content.slice(0, i) + newStr + content.slice(i + oldStr.length);
}
