import type { AtriumUIMessage } from '@shared/chat';
import type {
  Clarify,
  ClarifyQuestion,
  ClarifyResult,
  Subagent,
  SubagentStatus,
  Tool,
  ToolStatus,
  TraceSegment,
} from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import {
  type DynamicToolUIPart,
  getStaticToolName,
  isStaticToolUIPart,
  type ToolUIPart,
} from 'ai';
import { type MarkerToolName, TOOL_PRESENTATION, type ToolInput } from './tool-presentation';

/**
 * An assistant turn split for the Codex-style render: `thinking` is the
 * reasoning (its own "Thought" disclosure), `trace` is the work — tool calls
 * plus the narrative between them — under "Worked …", and `final` is the
 * concluding answer.
 */
/** A clarification card. Carries its render state so it can sit inline in the
 *  turn's flow (a resolved card before the reply it prompted, a pending card at
 *  the end) instead of being hoisted out of order. */
export type ClarifySegment = {
  kind: 'clarify';
  clarify: Clarify;
  /** No answer yet — render the interactive card; otherwise show the result. */
  pending: boolean;
  result?: ClarifyResult;
};

/** A generated/attached image shown inline (from a file part the agent emits,
 *  e.g. image_gen). Clicking it opens the full attachment viewer. */
export type ImageSegment = {
  kind: 'image';
  id: string;
  url: string;
  mediaType: string;
  filename?: string;
};

/** Trace segments as the renderer sees them — the shared clarify variant
 *  swapped for one carrying the answer state, plus inline images. */
export type ViewSegment =
  | Exclude<TraceSegment, { kind: 'clarify' }>
  | ClarifySegment
  | ImageSegment;

export type AssistantView = {
  thinking: ViewSegment[];
  trace: ViewSegment[];
  final: ViewSegment[];
  toolCount: number;
};

export function buildAssistantView(parts: AtriumUIMessage['parts']): AssistantView {
  const thinking: ViewSegment[] = [];
  const work: ViewSegment[] = []; // non-reasoning: narrative + tools + clarify, in order
  let lastToolIdx = -1;
  let toolCount = 0;
  let seq = 0;

  for (const part of parts) {
    if (part.type === 'reasoning') {
      const content = part.text.trim();
      if (content === '') continue;
      thinking.push({ kind: 'narrative', id: `s${seq++}`, content });
    } else if (part.type === 'text') {
      const content = part.text.trim();
      if (content === '') continue;
      work.push({ kind: 'narrative', id: `s${seq++}`, content });
    } else if (part.type === 'file' && part.mediaType.startsWith('image/')) {
      // Images the agent produced (image_gen emits a file part) render inline as
      // the deliverable. Not a tool, so it doesn't advance lastToolIdx — it
      // trails the generating tool and lands in `final`, shown prominently.
      work.push({
        kind: 'image',
        id: `s${seq++}`,
        url: part.url,
        mediaType: part.mediaType,
        filename: part.filename,
      });
    } else if (isStaticToolUIPart(part)) {
      const name = getStaticToolName<AtriumTools>(part);
      // The plan tool isn't trace work — it renders in the composer plan panel.
      if (name === 'todo_write') continue;
      // ask_clarification keeps its place in the flow but isn't a trace tool —
      // don't advance lastToolIdx (so a pending card stays in `final`, visible)
      // or count it toward the tool tally.
      if (name === 'ask_clarification') {
        const v = toClarifySegment(part);
        if (v) work.push(v);
        continue;
      }
      lastToolIdx = work.length;
      toolCount++;
      // A task call is a delegated subagent — render it as a nested card whose
      // live body the card pulls from the subagent store; everything else is a
      // flat tool marker.
      if (name === 'task') work.push({ kind: 'subagent', subagent: toSubagentModel(part) });
      else work.push({ kind: 'tool', tool: toToolModel(part, name) });
    } else if (part.type === 'dynamic-tool') {
      // An external agent's tool call — arbitrary name, rendered generically by
      // its ACP kind (the part.toolName) + the agent-supplied title.
      lastToolIdx = work.length;
      toolCount++;
      work.push({ kind: 'tool', tool: toDynamicToolModel(part) });
    }
  }

  // The answer is the work's trailing text after the last tool call (or all of
  // it when no tool ran); everything up to the last tool is process.
  const trace = work.slice(0, lastToolIdx + 1);
  const final = work.slice(lastToolIdx + 1);
  return { thinking, trace, final, toolCount };
}

/**
 * Map an ask_clarification call to a clarify segment. The model supplies the
 * questions as the tool input (no ids — we key by position); once answered, the
 * tool output carries the result for the read-only view. Skipped while the
 * input is still streaming, since the questions aren't complete yet.
 */
function toClarifySegment(part: AtriumToolPart): ClarifySegment | null {
  if (part.state === 'input-streaming') return null;
  const input = (part.input ?? {}) as { questions?: Omit<ClarifyQuestion, 'id'>[] };
  const questions = (input.questions ?? []).map((q, i) => ({ ...q, id: String(i) }));
  if (questions.length === 0) return null;
  return {
    kind: 'clarify',
    clarify: { id: part.toolCallId, questions },
    pending: part.state !== 'output-available',
    result: part.state === 'output-available' ? (part.output as ClarifyResult) : undefined,
  };
}

type AtriumToolPart = ToolUIPart<AtriumTools>;

function toToolModel(part: AtriumToolPart, name: MarkerToolName): Tool {
  const input = (part.input ?? {}) as ToolInput;
  const p = TOOL_PRESENTATION[name];
  const status = toStatus(part);
  return {
    id: part.toolCallId,
    name,
    // Present continuous while it runs ("Reading"), past tense once settled ("Read").
    verb: status === 'running' ? p.verbActive : p.verb,
    target: p.target(input),
    status,
    typeLabel: p.typeLabel(input),
    command: p.command?.(input),
    output: toOutput(part),
  };
}

/**
 * A task call rendered as a subagent card. Only id/name/status come from the
 * part; the tool list (body + count) is pulled live by the card from the
 * subagent store, since the subagent's own tool calls are never in the message.
 */
function toSubagentModel(part: AtriumToolPart): Subagent {
  const input = (part.input ?? {}) as ToolInput;
  return {
    id: part.toolCallId,
    name: input.description ?? input.subagent ?? 'Subagent',
    status: toSubagentStatus(part),
    result: part.state === 'output-available' ? String(part.output) : undefined,
  };
}

function toDynamicToolModel(part: DynamicToolUIPart): Tool {
  return {
    id: part.toolCallId,
    name: part.toolName,
    verb: '',
    target: part.title ?? part.toolName,
    status: toStatus(part),
    typeLabel: `Agent · ${part.toolName}`,
    output: toOutput(part),
  };
}

function toSubagentStatus(part: AtriumToolPart): SubagentStatus {
  switch (part.state) {
    case 'output-available':
      return 'done';
    case 'output-error':
      return 'failed';
    default:
      return 'streaming';
  }
}

function toStatus(part: AtriumToolPart | DynamicToolUIPart): ToolStatus {
  switch (part.state) {
    case 'output-available':
      return 'success';
    case 'output-error':
      return 'error';
    default:
      return 'running';
  }
}

function toOutput(part: AtriumToolPart | DynamicToolUIPart): string | undefined {
  if (part.state === 'output-error') return part.errorText;
  if (part.state === 'output-available') return String(part.output);
  return undefined;
}
