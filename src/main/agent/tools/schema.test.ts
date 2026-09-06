import { expect, mock, test } from 'bun:test';
import type { RunContext } from '../run-context';
import type { ToolCtx } from './context';
import type { AtriumTool } from './define';

/**
 * Pins every tool's name, description, and JSON Schema against a snapshot taken
 * from the zod definitions these were transcribed from — the model must see the
 * same schemas it saw before. The snapshot is normalized in one respect: zod
 * emitted `minimum`/`maximum` at the safe-integer bounds for every `int()`,
 * which carried no meaning and is not reproduced.
 *
 * A few tools reach the app runtime through their imports; those leaves are
 * stubbed so the toolset can be assembled outside Electron.
 */

mock.module('../scheduled', () => ({ scheduledManager: {} }));
mock.module('./builtins/computer-use/output', () => ({ runComputerAction: async () => '' }));

const { askClarificationTool } = await import('./builtins/ask-clarification');
const { bashTool } = await import('./builtins/bash');
const { bashOutputTool } = await import('./builtins/bash-output');
const cu = await import('./builtins/computer-use');
const { editFileTool } = await import('./builtins/edit-file');
const { globTool } = await import('./builtins/glob');
const { grepTool } = await import('./builtins/grep');
const { killShellTool } = await import('./builtins/kill-shell');
const { listDirTool } = await import('./builtins/list-dir');
const { memoryDirTool, memoryTool } = await import('./builtins/memory');
const { profileTool } = await import('./builtins/profile');
const { readFileTool } = await import('./builtins/read-file');
const sched = await import('./builtins/schedule');
const { skillTool } = await import('./builtins/skill');
const { taskTool } = await import('./builtins/task');
const { todoWriteTool } = await import('./builtins/todo-write');
const { viewImageTool } = await import('./builtins/view-image');
const { webFetchTool } = await import('./builtins/web-fetch');
const { webSearchTool } = await import('./builtins/web-search');
const { writeFileTool } = await import('./builtins/write-file');

const snapshot = await Bun.file(`${import.meta.dir}/__snapshots__/tool-schemas.json`).json();

const run = {} as RunContext;
const ctx = { workspaceRoot: '/ws', run } as ToolCtx;

// The description of these three lists what the user has configured, so the
// snapshot pins the empty case.
const tools: Array<[string, AtriumTool]> = [
  ['read_file', readFileTool(ctx)],
  ['write_file', writeFileTool(ctx)],
  ['edit_file', editFileTool(ctx)],
  ['list_dir', listDirTool(ctx)],
  ['grep', grepTool(ctx)],
  ['glob', globTool(ctx)],
  ['bash', bashTool(ctx)],
  ['bash_output', bashOutputTool(ctx)],
  ['kill_shell', killShellTool(ctx)],
  ['todo_write', todoWriteTool()],
  ['web_fetch', webFetchTool()],
  ['web_search', webSearchTool()],
  ['task', taskTool({ siblings: () => [], subagents: [], run })],
  ['skill', skillTool({ skills: [], run })],
  ['ask_clarification', askClarificationTool()],
  ['view_image', viewImageTool(ctx)],
  ['memory', memoryTool(ctx)],
  ['profile', profileTool()],
  ['schedule_create', sched.scheduleCreateTool()],
  ['schedule_list', sched.scheduleListTool()],
  ['schedule_update', sched.scheduleUpdateTool()],
  ['schedule_cancel', sched.scheduleCancelTool()],
  ['computer_list_apps', cu.computerListAppsTool(ctx)],
  ['computer_get_app_state', cu.computerGetAppStateTool(ctx)],
  ['computer_click', cu.computerClickTool(ctx)],
  ['computer_type_text', cu.computerTypeTextTool(ctx)],
  ['computer_press_key', cu.computerPressKeyTool(ctx)],
  ['computer_scroll', cu.computerScrollTool(ctx)],
  ['computer_drag', cu.computerDragTool(ctx)],
  ['computer_set_value', cu.computerSetValueTool(ctx)],
  ['computer_perform_action', cu.computerPerformActionTool(ctx)],
  ['memory__dir', memoryDirTool('/tmp/x')],
];

test('every tool is snapshotted', () => {
  expect(tools.map(([key]) => key).sort()).toEqual(Object.keys(snapshot).sort());
});

for (const [key, t] of tools) {
  test(`${key}: schema and description are unchanged`, () => {
    expect({
      description: t.description,
      parameters: JSON.parse(JSON.stringify(t.parameters)),
    }).toEqual(snapshot[key]);
  });
}

test('tool names match their registry keys', () => {
  // memory__dir is the dream agent's copy — same tool name, its own snapshot key
  for (const [key, t] of tools) expect(t.name).toBe(key === 'memory__dir' ? 'memory' : key);
});
