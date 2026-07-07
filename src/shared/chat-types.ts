/**
 * Shared trace / tool / subagent types used by the chat rendering components.
 *
 * Assistant turn is a Trace containing an ordered list of segments
 * (narrative prose / atomic tool calls / subagent cards), in the
 * order they happened. The "final answer" is the last narrative
 * segment — no separate field.
 */

export type ToolStatus = 'running' | 'success' | 'error' | 'cancelled' | 'warning';

/** A single step in the agent's plan, written via the `todo_write` tool. */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export type Todo = { content: string; status: TodoStatus };

export type Tool = {
  id: string;
  /** The tool's name — the icon key. A built-in ToolName, or (for an external
   *  agent's tools) an ACP tool kind like "edit"/"execute". */
  name: string;
  verb: string;
  target: string;
  status: ToolStatus;
  typeLabel?: string;
  command?: string;
  output?: string;
};

/** Image a tool returned inline (MCP image blocks, view_image). dataUrl feeds
 *  <img src> directly; the model-facing conversion strips the data: prefix.
 *  filename, when known, titles the attachment viewer. */
export type ToolResultImage = { mediaType: string; dataUrl: string; filename?: string };

/** Structured tool output: flattened text plus the images worth showing. */
export type ImageToolOutput = { text: string; images: ToolResultImage[] };

export function isImageToolOutput(value: unknown): value is ImageToolOutput {
  if (value == null || typeof value !== 'object') return false;
  const v = value as { text?: unknown; images?: unknown };
  return typeof v.text === 'string' && Array.isArray(v.images);
}

export type SubagentStatus = 'streaming' | 'done' | 'failed' | 'cancelled';

export type Subagent = {
  id: string;
  /** Short user-facing name, e.g. "Research US stock market overview" */
  name: string;
  status: SubagentStatus;
  /** The subagent's final returned text (persisted in the task part). Shown as
   *  the card body when its live activity isn't around — e.g. after a reload,
   *  since the step-by-step activity itself isn't persisted. */
  result?: string;
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
};

export type Clarify = {
  id: string;
  /** 1-4 questions answered in sequence; rendered as tabs when length > 1. */
  questions: ClarifyQuestion[];
};

/** One question's resolved answer. For multi-select, picks are joined into one
 *  readable string. The model reads these as the ask_clarification result. */
export type ClarifyAnswer = { question: string; answer: string };

/** The ask_clarification tool's output, submitted via addToolOutput. `cancelled`
 *  marks a dismissed question — the user took back the turn without answering. */
export type ClarifyResult = { answers: ClarifyAnswer[]; cancelled?: boolean };

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
