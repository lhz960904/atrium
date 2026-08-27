type MessageLike = { parts: { type: string }[] };
type LoosePart = { type: string; state?: string; errorText?: string };

const SEAL_ERROR = 'Stopped before the tool returned.';

/** A tool call still awaiting its result — persisted this way it's a dangling
 *  tool_use with no matching tool_result. */
function isDangling(part: LoosePart): boolean {
  return (
    (part.type.startsWith('tool-') || part.type === 'dynamic-tool') &&
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
export function sealMessageToolCalls<M extends MessageLike>(msg: M): M {
  if (!msg.parts.some((part) => isDangling(part as LoosePart))) return msg;
  const parts = msg.parts.map((part) =>
    isDangling(part as LoosePart)
      ? { ...part, state: 'output-error', errorText: SEAL_ERROR }
      : part,
  ) as M['parts'];
  return { ...msg, parts };
}

export function sealDanglingToolCalls<M extends MessageLike>(messages: M[]): M[] {
  return messages.map((m) => sealMessageToolCalls(m));
}
