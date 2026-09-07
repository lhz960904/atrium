import { modelPricing } from '../models/catalog';
import { listSubagentDefs } from '../subagent/defs';
import { askClarificationTool } from './builtins/ask-clarification';
import { bashTool } from './builtins/bash';
import { bashOutputTool } from './builtins/bash-output';
import {
  computerClickTool,
  computerDragTool,
  computerGetAppStateTool,
  computerListAppsTool,
  computerPerformActionTool,
  computerPressKeyTool,
  computerScrollTool,
  computerSetValueTool,
  computerTypeTextTool,
} from './builtins/computer-use';
import { editFileTool } from './builtins/edit-file';
import { globTool } from './builtins/glob';
import { grepTool } from './builtins/grep';
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
import { viewImageTool } from './builtins/view-image';
import { webFetchTool } from './builtins/web-fetch';
import { webSearchTool } from './builtins/web-search';
import { writeFileTool } from './builtins/write-file';
import type { ToolCtx } from './context';
import type { AtriumTool } from './define';

/**
 * Assemble the agent's toolset for a run: the built-ins plus any MCP server
 * tools (named mcp__<server>__<tool>). Built-ins come last and win on a name
 * collision, so an MCP server can never shadow one. The task tool advertises
 * the available subagents (from ctx.run.db), resolved per call so freshly
 * created ones show up.
 */
export function getTools(ctx: ToolCtx): AtriumTool[] {
  // The task tool hands its child a slice of this same set, so it reads the
  // assembled list at call time rather than being handed one that includes it.
  let assembled: AtriumTool[] = [];
  // macOS desktop-automation tools, grouped so getTools can drop them wholesale
  // when the helper is unavailable (see the ctx.computerUse guard below).
  const computerBuiltins = [
    computerListAppsTool(ctx),
    computerGetAppStateTool(ctx),
    computerClickTool(ctx),
    computerTypeTextTool(ctx),
    computerPressKeyTool(ctx),
    computerScrollTool(ctx),
    computerDragTool(ctx),
    computerSetValueTool(ctx),
    computerPerformActionTool(ctx),
  ];
  const builtins: AtriumTool[] = [
    readFileTool(ctx),
    writeFileTool(ctx),
    editFileTool(ctx),
    listDirTool(ctx),
    grepTool(ctx),
    globTool(ctx),
    bashTool(ctx),
    bashOutputTool(ctx),
    killShellTool(ctx),
    todoWriteTool(),
    webFetchTool(),
    webSearchTool(),
    taskTool({
      pricingOf: modelPricing,
      subagents: listSubagentDefs(ctx.run.db),
      run: ctx.run,
      engine: ctx.engine,
      siblings: () => assembled,
    }),
    skillTool({ skills: ctx.skills ?? [], run: ctx.run }),
    askClarificationTool(),
    viewImageTool(ctx),
    memoryTool(ctx),
    profileTool(),
    scheduleCreateTool(),
    scheduleListTool(),
    scheduleUpdateTool(),
    scheduleCancelTool(),
    // Computer Use is macOS-only and rides on the helper's availability; when it
    // is absent (non-mac, or later disabled in settings) don't advertise its
    // tools to the model at all, rather than failing them at call time.
    ...(ctx.computerUse ? computerBuiltins : []),
  ];
  const names = new Set(builtins.map((t) => t.name));
  assembled = [...(ctx.mcpTools ?? []).filter((t) => !names.has(t.name)), ...builtins];
  return assembled;
}
