import type { ToolName } from '@shared/tools';
import type { Tool } from 'ai';
import { listEnabledImageModels } from '../../providers/image-models';
import { maxContextTokens } from '../models/catalog';
import { makeNeedsApproval } from '../permissions';
import { listSubagentDefs } from '../subagent/defs';
import { askClarificationTool } from './builtins/ask-clarification';
import { bashTool } from './builtins/bash';
import { bashOutputTool } from './builtins/bash-output';
import { editFileTool } from './builtins/edit-file';
import { globTool } from './builtins/glob';
import { grepTool } from './builtins/grep';
import { imageGenTool } from './builtins/image-gen';
import { killShellTool } from './builtins/kill-shell';
import { listDirTool } from './builtins/list-dir';
import { readFileTool } from './builtins/read-file';
import { skillTool } from './builtins/skill';
import { taskTool } from './builtins/task';
import { todoWriteTool } from './builtins/todo-write';
import { webFetchTool } from './builtins/web-fetch';
import { webSearchTool } from './builtins/web-search';
import { writeFileTool } from './builtins/write-file';
import type { ToolCtx } from './context';

/**
 * Assemble the built-in tools for a given sandbox context. The return type is
 * keyed by ToolName, so the registry and the shared name contract can't drift.
 * The task tool advertises the available subagents (from ctx.db), resolved per
 * call so freshly created ones show up.
 */
/** Gate a tool behind the permission check — it pauses for approval when the
 *  call crosses the workspace boundary under the active mode. */
function gate(name: ToolName, ctx: ToolCtx, t: Tool): Tool {
  return { ...t, needsApproval: makeNeedsApproval(name, ctx) };
}

export function getTools(ctx: ToolCtx): Record<ToolName, Tool> {
  return {
    read_file: readFileTool(ctx),
    write_file: gate('write_file', ctx, writeFileTool(ctx)),
    edit_file: gate('edit_file', ctx, editFileTool(ctx)),
    list_dir: listDirTool(ctx),
    grep: grepTool(ctx),
    glob: globTool(ctx),
    bash: gate('bash', ctx, bashTool(ctx)),
    bash_output: bashOutputTool(ctx),
    kill_shell: killShellTool(ctx),
    todo_write: todoWriteTool(),
    web_fetch: webFetchTool(),
    web_search: webSearchTool(),
    task: taskTool({
      maxContextTokens,
      subagents: listSubagentDefs(ctx.db),
    }),
    skill: skillTool({ skills: ctx.skills ?? [] }),
    ask_clarification: askClarificationTool(),
    image_gen: imageGenTool({ models: listEnabledImageModels(ctx.db) }),
  };
}
