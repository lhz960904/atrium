import type { ToolSet } from 'ai';
import { bashTool } from './builtins/bash';
import { listDirTool } from './builtins/list-dir';
import { readFileTool } from './builtins/read-file';
import { writeFileTool } from './builtins/write-file';
import type { ToolCtx } from './context';

/** Assemble the built-in tools for a given sandbox context. */
export function getTools(ctx: ToolCtx): ToolSet {
  return {
    read_file: readFileTool(ctx),
    write_file: writeFileTool(ctx),
    list_dir: listDirTool(ctx),
    bash: bashTool(ctx),
  };
}
