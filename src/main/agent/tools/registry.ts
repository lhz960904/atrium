import type { ToolName } from '@shared/tools';
import type { Tool } from 'ai';
import { bashTool } from './builtins/bash';
import { listDirTool } from './builtins/list-dir';
import { readFileTool } from './builtins/read-file';
import { todoWriteTool } from './builtins/todo-write';
import { webFetchTool } from './builtins/web-fetch';
import { writeFileTool } from './builtins/write-file';
import type { ToolCtx } from './context';

/**
 * Assemble the built-in tools for a given sandbox context. The return type is
 * keyed by ToolName, so the registry and the shared name contract can't drift.
 */
export function getTools(ctx: ToolCtx): Record<ToolName, Tool> {
  return {
    read_file: readFileTool(ctx),
    write_file: writeFileTool(ctx),
    list_dir: listDirTool(ctx),
    bash: bashTool(ctx),
    todo_write: todoWriteTool(),
    web_fetch: webFetchTool(),
  };
}
