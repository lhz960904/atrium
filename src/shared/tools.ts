/**
 * The tool-name contract shared between the agent (main process, which
 * implements each tool — schemas, descriptions, execute) and the renderer
 * (which renders tool calls by name). Only the names cross the boundary. The
 * runtime array is the source of truth so the type can't drift from a list the
 * UI iterates (e.g. the subagent tool-allow picker).
 */
export const TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'grep',
  'glob',
  'bash',
  'bash_output',
  'kill_shell',
  'todo_write',
  'web_fetch',
  'web_search',
  'task',
  'skill',
  'ask_clarification',
  'view_image',
  'memory',
  'profile',
  'schedule_create',
  'schedule_list',
  'schedule_update',
  'schedule_cancel',
  'computer_list_apps',
  'computer_get_app_state',
  'computer_click',
  'computer_type_text',
  'computer_press_key',
  'computer_scroll',
  'computer_drag',
  'computer_set_value',
  'computer_perform_action',
] as const;

/**
 * Tools the agent no longer implements. Stored threads still carry their parts,
 * so the renderer must keep rendering them — but nothing may offer them again.
 */
export const RETIRED_TOOL_NAMES = ['image_gen'] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type RetiredToolName = (typeof RETIRED_TOOL_NAMES)[number];

/**
 * The tools generic for UIMessage. We only care that tool parts carry a typed
 * name (so the renderer's tool table is exhaustive); inputs/outputs are read
 * loosely, so they stay `unknown` rather than dragging schemas into the type.
 */
export type AtriumTools = Record<ToolName | RetiredToolName, { input: unknown; output: unknown }>;
