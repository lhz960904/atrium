/**
 * Shared message / trace / tool / subagent types used by mock-threads
 * + chat rendering components.
 *
 * Assistant turn is a Trace containing an ordered list of segments
 * (narrative prose / atomic tool calls / subagent cards), in the
 * order they happened. The "final answer" is the last narrative
 * segment — no separate field.
 *
 * Subagent.body uses the same TraceSegment[] shape (subagents nest).
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
  verb: string;
  target: string;
  status: ToolStatus;
  typeLabel?: string;
  command?: string;
  output?: string;
};

export type SubagentStatus = 'streaming' | 'done' | 'failed' | 'cancelled';

export type Subagent = {
  id: string;
  /** Short user-facing name, e.g. "Research US stock market overview" */
  name: string;
  status: SubagentStatus;
  /** Total tool calls inside body (cached for the head chip) */
  toolCount: number;
  /** Subagent's own narrative + tool list, in order. Same shape as parent trace. */
  body: TraceSegment[];
};

export type ClarifyInputType = 'single' | 'multi' | 'text';

export type ClarifyOption = {
  label: string;
  /** Optional preview (pseudo-code / mockup / note) shown in a side panel when this option is focused. Only meaningful for single input_type. */
  preview?: string;
};

export type ClarifyQuestion = {
  id: string;
  /** Short label (≤ 12 chars recommended) used as the tab title when there are multiple questions. Mirrors Claude Code's AskUserQuestion `header`. */
  header: string;
  question: string;
  inputType: ClarifyInputType;
  /** Required for single / multi. */
  options?: ClarifyOption[];
  /** Optional explanation rendered under the question. */
  context?: string;
  /** Single only: whether the Other (free-text fallback) row is shown. */
  allowOther?: boolean;
};

export type Clarify = {
  id: string;
  /** 1-4 questions answered in sequence; rendered as tabs when length > 1. */
  questions: ClarifyQuestion[];
};

export type TraceSegment =
  | { kind: 'narrative'; id: string; content: string }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'subagent'; subagent: Subagent }
  | { kind: 'clarify'; clarify: Clarify };

export type Trace = {
  /** Header summary, e.g. "Worked for 18s". */
  summary: string;
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
