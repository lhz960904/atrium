import type { AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';

/** Repair and reconcile tool results in the stored conversation transcript. */

const UNKNOWN_OUTCOME = 'The previous execution was interrupted; the tool outcome is unknown.';

const isToolCall = (content: { type: string }): content is ToolCall => content.type === 'toolCall';

/**
 * Pair every tool call with a result. A turn cut short — a user stop, a crash,
 * a killed scheduled run — leaves a tool call whose result never arrived, and a
 * provider rejects any later request whose history holds one. Sealing them as
 * error results keeps one interrupted turn from wedging the thread forever.
 *
 * `reasonFor` says what actually happened to a call, which the caller knows
 * from what the run recorded. The reason goes in the model-facing content, the
 * one place a failure's text is read from.
 */
export function sealDanglingToolCalls(
  messages: Message[],
  reasonFor: (call: ToolCall) => string = () => UNKNOWN_OUTCOME,
): Message[] {
  const answered = new Set(
    messages
      .filter((m): m is ToolResultMessage => m.role === 'toolResult')
      .map((m) => m.toolCallId),
  );
  const out: Message[] = [];
  for (const message of messages) {
    out.push(message);
    if (message.role !== 'assistant') continue;
    for (const content of (message as AssistantMessage).content) {
      if (!isToolCall(content) || answered.has(content.id)) continue;
      answered.add(content.id);
      out.push({
        role: 'toolResult',
        toolCallId: content.id,
        toolName: content.name,
        content: [{ type: 'text', text: reasonFor(content) }],
        isError: true,
        timestamp: message.timestamp,
      });
    }
  }
  return out;
}
