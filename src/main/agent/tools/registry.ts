import type { ToolName } from '@shared/tools';
import type { Tool } from 'ai';
import { maxContextTokens } from '../models/catalog';
import { listSubagentDefs } from '../subagent/defs';
import { bashTool } from './builtins/bash';
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
export function getTools(ctx: ToolCtx): Record<ToolName, Tool> {
  return {
    read_file: readFileTool(ctx),
    write_file: writeFileTool(ctx),
    list_dir: listDirTool(ctx),
    bash: bashTool(ctx),
    todo_write: todoWriteTool(),
    web_fetch: webFetchTool(),
    web_search: webSearchTool(),
    task: taskTool({
      maxContextTokens,
      subagents: listSubagentDefs(ctx.db),
    }),
    skill: skillTool({ skills: ctx.skills ?? [] }),
  };
}
