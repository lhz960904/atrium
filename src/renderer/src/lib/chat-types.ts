/**
 * Shared message / trace / tool types used by mock-threads + chat
 * rendering components.
 *
 * The assistant turn is a Trace containing an ordered list of segments
 * (narrative prose interleaved with tool calls), modelled after Codex:
 * agent text and tool invocations show up in the order they happened.
 * The final "answer" is just the last narrative segment in that list,
 * not a separate field.
 */

export type ToolKind =
  | 'shell'
  | 'file-read'
  | 'file-write'
  | 'file-edit'
  | 'grep'
  | 'glob'
  | 'web-search'
  | 'web-fetch'
  | 'task'
  | 'other';

export type ToolStatus = 'running' | 'success' | 'error' | 'cancelled' | 'warning';

export type Tool = {
  id: string;
  kind: ToolKind;
  /** "Ran" / "Read" / "Searched" — dim verb shown before target */
  verb: string;
  /** "ls src/auth" / "src/auth/oauth.ts" / "OAuth handlers" — single-line target */
  target: string;
  status: ToolStatus;
  /** Type label shown above the expanded card body ("Shell" / "File" / "HTTP") */
  typeLabel?: string;
  /** Shell-only: actual command shown as `$ <command>` */
  command?: string;
  /** Shell-only: stdout. Empty string treated as "No output". */
  output?: string;
};

export type TraceSegment =
  | { kind: 'narrative'; id: string; content: string }
  | { kind: 'tool'; tool: Tool };

export type Trace = {
  /** Header summary, e.g. "Worked for 18s". UI shows it next to the chev. */
  summary: string;
  /** Whether the trace is still running. Drives pulsing dot + default-open. */
  running?: boolean;
  segments: TraceSegment[];
};

export type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; trace: Trace };

export type Thread = {
  id: string;
  title: string;
  messages: ChatMessage[];
};
