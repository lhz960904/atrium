/**
 * Minimal system prompt for the agent loop. Prompt assembly (skills / memory /
 * custom-instructions injection, sectioning) gets its own files in this
 * directory later — kept as one builder for now.
 *
 * The workspace root is injected so the model can address files with absolute
 * paths (its natural mode, from Claude Code), all confined under this root.
 */
export function buildSystemPrompt(workspaceRoot: string): string {
  return `You are Atrium, a capable AI assistant running on the user's Mac.

Your workspace is: ${workspaceRoot}
File and shell tools operate inside this workspace. Use absolute paths under it (e.g. ${workspaceRoot}/notes.txt). Paths outside the workspace are rejected.

Prefer using tools to inspect real state over guessing. When you call a tool, first explain briefly why. After gathering what you need, give a clear, direct answer.`;
}
