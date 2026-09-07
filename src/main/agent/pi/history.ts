import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from '@shared/protocol';

/**
 * Transcript surgery on pi messages: the two fixes a run needs before the model
 * sees its history. Both are pure — the caller decides whether the result is the
 * stored transcript (sealing, which repairs a real corruption) or a per-call
 * view (the date note, which must never persist).
 */

const SEAL_ERROR = 'Stopped before the tool returned.';

const isToolCall = (content: { type: string }): content is ToolCall => content.type === 'toolCall';

/**
 * Pair every tool call with a result. A turn cut short — a user stop, a crash,
 * a killed scheduled run — leaves a tool call whose result never arrived, and a
 * provider rejects any later request whose history holds one. Sealing them as
 * error results keeps one interrupted turn from wedging the thread forever.
 */
export function sealDanglingToolCalls(messages: Message[]): Message[] {
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
        content: [{ type: 'text', text: SEAL_ERROR }],
        details: { errorText: SEAL_ERROR },
        isError: true,
        timestamp: message.timestamp,
      });
    }
  }
  return out;
}

/**
 * Prepend a `<system-reminder>` to a user message — on the message rather than
 * the system prompt, so the cached system prefix stays byte-stable.
 *
 * `anchor: 'first'` targets the earliest user turn, right for context that is
 * identical every turn (memory, skills, instructions) so it rides inside the
 * cached prefix. `anchor: 'last'` targets the current turn, right for a value
 * that changes every turn (the date) so the churn stays on the uncached tail.
 */
export function injectSystemReminder(
  messages: AgentMessage[],
  inner: string,
  opts: { anchor?: 'first' | 'last' } = {},
): AgentMessage[] {
  const isUser = (m: AgentMessage): boolean => m.role === 'user';
  const at = opts.anchor === 'last' ? messages.findLastIndex(isUser) : messages.findIndex(isUser);
  if (at < 0) return messages;

  const target = messages[at] as Extract<Message, { role: 'user' }>;
  const reminder = {
    type: 'text' as const,
    text: `<system-reminder>\n${inner}\n</system-reminder>`,
  };
  const content =
    typeof target.content === 'string'
      ? [reminder, { type: 'text' as const, text: target.content }]
      : [reminder, ...target.content];
  return [...messages.slice(0, at), { ...target, content }, ...messages.slice(at + 1)];
}
