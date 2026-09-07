import type {
  AgentSessionEvent,
  AssistantMessage,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from '@shared/protocol';
import { createLogger } from '../../log';
import type { AtriumTool } from '../tools';

const log = createLogger('approval');

/**
 * A call the engine refused to run because it is the user's to settle: a
 * boundary crossing waiting for approval, or a tool only the user can answer.
 * Parking ends the turn with the call unanswered — the decision arrives later,
 * possibly after a restart, and resumes the run.
 */
export type ParkedCall = {
  toolCallId: string;
  toolName: string;
  /** Set when the pause is an approval; absent for a tool the user answers. */
  approvalId?: string;
};

/** What the user came back with for a parked call. */
export type Resolution =
  | { toolCallId: string; kind: 'approved' }
  | { toolCallId: string; kind: 'denied'; reason?: string }
  | { toolCallId: string; kind: 'answered'; output: unknown };

const DENIED_TEXT = 'The user denied this call. Do not retry it; adjust your approach.';

const text = (value: string): TextContent[] => [{ type: 'text', text: value }];

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
};

/** Every tool call a transcript holds, by id — the parked ones live in earlier turns. */
export function toolCallsById(messages: Message[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const content of (message as AssistantMessage).content) {
      if (content.type === 'toolCall') {
        const call = content as ToolCall;
        calls.set(call.id, call);
      }
    }
  }
  return calls;
}

function resultMessage(
  call: ToolCall,
  parts: Pick<ToolResultMessage, 'content' | 'details' | 'isError'>,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    timestamp: Date.now(),
    ...parts,
  };
}

/**
 * Settle the calls the user has now decided, before the loop resumes. An
 * approved call runs here rather than inside the loop: the engine only executes
 * calls from the turn it is currently streaming, and this one belongs to a turn
 * that already ended. The wire still sees the ordinary execution bracket, so
 * the card fills in exactly as it would have.
 *
 * A resolution whose call is missing from the transcript is dropped: the run it
 * belonged to was rewritten or removed, and inventing a result would attach it
 * to nothing.
 */
export async function applyResolutions(opts: {
  resolutions: Resolution[];
  messages: Message[];
  tools: AtriumTool[];
  emit: (event: AgentSessionEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<ToolResultMessage[]> {
  if (opts.resolutions.length === 0) return [];
  const calls = toolCallsById(opts.messages);
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const out: ToolResultMessage[] = [];

  for (const resolution of opts.resolutions) {
    const call = calls.get(resolution.toolCallId);
    if (!call) {
      log.warn(`resolution for an unknown call ${resolution.toolCallId}, dropped`);
      continue;
    }

    if (resolution.kind === 'denied') {
      const reason = resolution.reason?.trim() || DENIED_TEXT;
      out.push(
        resultMessage(call, {
          content: text(reason),
          details: { denied: true, errorText: reason },
          isError: true,
        }),
      );
      continue;
    }

    if (resolution.kind === 'answered') {
      out.push(
        resultMessage(call, {
          content: text(stringify(resolution.output)),
          details: resolution.output,
          isError: false,
        }),
      );
      continue;
    }

    const tool = byName.get(call.name);
    if (!tool) {
      const missing = `Tool ${call.name} is no longer available.`;
      out.push(
        resultMessage(call, {
          content: text(missing),
          details: { errorText: missing },
          isError: true,
        }),
      );
      continue;
    }

    opts.emit({
      type: 'tool_execution_start',
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
    });
    try {
      const result = await tool.execute(call.id, call.arguments, opts.abortSignal);
      opts.emit({
        type: 'tool_execution_end',
        toolCallId: call.id,
        toolName: call.name,
        result,
        isError: false,
      });
      out.push(resultMessage(call, { ...result, isError: false }));
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const failed = { content: text(errorText), details: { errorText } };
      opts.emit({
        type: 'tool_execution_end',
        toolCallId: call.id,
        toolName: call.name,
        result: failed,
        isError: true,
      });
      out.push(resultMessage(call, { ...failed, isError: true }));
    }
  }
  return out;
}
