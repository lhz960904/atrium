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
  'image_gen',
  'memory',
  'profile',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * The tools generic for UIMessage. We only care that tool parts carry a typed
 * name (so the renderer's tool table is exhaustive); inputs/outputs are read
 * loosely, so they stay `unknown` rather than dragging schemas into the type.
 */
export type AtriumTools = Record<ToolName, { input: unknown; output: unknown }>;
