import type { AtriumUIMessage } from '@shared/chat';
import type { Tool, ToolStatus, TraceSegment } from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import { getStaticToolName, isStaticToolUIPart, type ToolUIPart } from 'ai';
import { TOOL_PRESENTATION, type ToolInput } from './tool-presentation';

/**
 * An assistant turn split for the Codex-style render: `thinking` is the
 * reasoning (its own "Thought" disclosure), `trace` is the work — tool calls
 * plus the narrative between them — under "Worked …", and `final` is the
 * concluding answer.
 */
export type AssistantView = {
  thinking: TraceSegment[];
  trace: TraceSegment[];
  final: TraceSegment[];
  toolCount: number;
};

export function buildAssistantView(parts: AtriumUIMessage['parts']): AssistantView {
  const thinking: TraceSegment[] = [];
  const work: TraceSegment[] = []; // non-reasoning: narrative + tools, in order
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
    } else if (isStaticToolUIPart(part)) {
      lastToolIdx = work.length;
      toolCount++;
      work.push({ kind: 'tool', tool: toToolModel(part) });
    }
  }

  // The answer is the work's trailing text after the last tool call (or all of
  // it when no tool ran); everything up to the last tool is process.
  const trace = work.slice(0, lastToolIdx + 1);
  const final = work.slice(lastToolIdx + 1);
  return { thinking, trace, final, toolCount };
}

type AtriumToolPart = ToolUIPart<AtriumTools>;

function toToolModel(part: AtriumToolPart): Tool {
  const name = getStaticToolName<AtriumTools>(part);
  const input = (part.input ?? {}) as ToolInput;
  const p = TOOL_PRESENTATION[name];
  return {
    id: part.toolCallId,
    name,
    verb: p.verb,
    target: p.target(input),
    status: toStatus(part),
    typeLabel: p.typeLabel(input),
    command: p.command?.(input),
    output: toOutput(part),
  };
}

function toStatus(part: AtriumToolPart): ToolStatus {
  switch (part.state) {
    case 'output-available':
      return 'success';
    case 'output-error':
      return 'error';
    default:
      return 'running';
  }
}

function toOutput(part: AtriumToolPart): string | undefined {
  if (part.state === 'output-error') return part.errorText;
  if (part.state === 'output-available') return String(part.output);
  return undefined;
}
