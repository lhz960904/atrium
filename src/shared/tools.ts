/**
 * The tool-name contract shared between the agent (main process, which
 * implements each tool — schemas, descriptions, execute) and the renderer
 * (which renders tool calls by name). Only the names cross the boundary.
 */
export type ToolName = 'read_file' | 'write_file' | 'list_dir' | 'bash';

/**
 * The tools generic for UIMessage. We only care that tool parts carry a typed
 * name (so the renderer's tool table is exhaustive); inputs/outputs are read
 * loosely, so they stay `unknown` rather than dragging schemas into the type.
 */
export type AtriumTools = Record<ToolName, { input: unknown; output: unknown }>;
