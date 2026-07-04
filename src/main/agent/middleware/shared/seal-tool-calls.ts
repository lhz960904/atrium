import { isToolOrDynamicToolUIPart, type UIMessage } from 'ai';

type Part = UIMessage['parts'][number];

const SEAL_ERROR = 'Stopped before the tool returned.';

/** A tool call still awaiting its result — persisted this way it's a dangling
 *  tool_use with no matching tool_result. */
function isDangling(part: Part): boolean {
  return (
    isToolOrDynamicToolUIPart(part) &&
    (part.state === 'input-streaming' || part.state === 'input-available')
  );
}

/**
 * Seal tool calls that never returned. A turn cut short — the user stops it, or
 * the process is killed mid scheduled run — leaves its emitted tool calls at
 * 'input-available' / 'input-streaming'. A model provider rejects a request whose
 * history holds a tool_use with no tool_result, so flip each unfinished call to a
 * terminal 'output-error', keeping tool_use <-> tool_result paired. A message
 * with nothing dangling is returned unchanged (same reference).
 */
export function sealMessageToolCalls(msg: UIMessage): UIMessage {
  if (!msg.parts.some(isDangling)) return msg;
  const parts = msg.parts.map((part) =>
    isDangling(part) ? ({ ...part, state: 'output-error', errorText: SEAL_ERROR } as Part) : part,
  );
  return { ...msg, parts };
}

export function sealDanglingToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages.map(sealMessageToolCalls);
}
