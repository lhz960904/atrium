import type { AgentMessage, AgentMessage as Message } from '@earendil-works/pi-agent-core';
import { currentDateNote } from '../prompts';
import type { HookSet } from '../runtime/hook-compose';

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

/** Tells the model today's date on the latest user turn. */
export function dateReminder(): HookSet {
  return {
    name: 'date-reminder',
    transformContext: async (messages) =>
      injectSystemReminder(messages, currentDateNote(new Date()), { anchor: 'last' }),
  };
}
