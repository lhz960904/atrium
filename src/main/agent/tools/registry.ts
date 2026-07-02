import type { ToolName } from '@shared/tools';
import type { Tool } from 'ai';
import { listEnabledImageModels } from '../../providers/image-models';
import { maxContextTokens, modelPricing } from '../models/catalog';
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
import { memoryTool } from './builtins/memory';
import { profileTool } from './builtins/profile';
import { readFileTool } from './builtins/read-file';
import {
  scheduleCancelTool,
  scheduleCreateTool,
  scheduleListTool,
  scheduleUpdateTool,
} from './builtins/schedule';
import { skillTool } from './builtins/skill';
import { taskTool } from './builtins/task';
import { todoWriteTool } from './builtins/todo-write';
import { webFetchTool } from './builtins/web-fetch';
import { webSearchTool } from './builtins/web-search';
import { writeFileTool } from './builtins/write-file';
import type { ToolCtx } from './context';

/**
 * Assemble the agent's toolset for a sandbox context: the built-ins (keyed by
 * ToolName, so they can't drift from the shared name contract) plus any MCP
 * server tools (keyed by their qualified mcp__<server>__<tool> name) — hence the
 * Record<string, Tool> return. Built-ins are spread last so an MCP server can
 * never shadow one. The task tool advertises the available subagents (from
 * ctx.db), resolved per call so freshly created ones show up.
 */
/** Gate a tool behind the permission check — it pauses for approval when the
 *  call crosses the workspace boundary under the active mode. */
function gate(name: string, ctx: ToolCtx, t: Tool): Tool {
  return { ...t, needsApproval: makeNeedsApproval(name, ctx) };
}

/** Gate every MCP tool — they always cross the boundary (see classifyToolCall). */
function gateMcpTools(
  mcpTools: Record<string, Tool> | undefined,
  ctx: ToolCtx,
): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const [name, t] of Object.entries(mcpTools ?? {})) out[name] = gate(name, ctx, t);
  return out;
}

export function getTools(ctx: ToolCtx): Record<string, Tool> {
  const builtins: Record<ToolName, Tool> = {
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
      pricingOf: modelPricing,
      subagents: listSubagentDefs(ctx.db),
    }),
    skill: skillTool({ skills: ctx.skills ?? [] }),
    ask_clarification: askClarificationTool(),
    image_gen: imageGenTool({ models: listEnabledImageModels(ctx.db) }),
    memory: memoryTool(ctx),
    profile: profileTool(),
    schedule_create: scheduleCreateTool(),
    schedule_list: scheduleListTool(),
    schedule_update: scheduleUpdateTool(),
    schedule_cancel: scheduleCancelTool(),
  };
  // MCP tools first so a built-in can never be shadowed by a server tool.
  return { ...gateMcpTools(ctx.mcpTools, ctx), ...builtins };
}
