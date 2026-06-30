import type { UIMessage } from 'ai';

/**
 * Prepend a <system-reminder> to a user message — on the message, not the system
 * prompt, so the system prefix stays cacheable. Cloned, not mutated, so it never
 * leaks into the persisted/UI messages.
 *
 * anchor 'first' (default) targets the earliest user turn — right for stable
 * per-conversation context (memory, skills, instructions): identical across turns,
 * so it rides inside the cached prefix without churning it. anchor 'last' targets
 * the current turn — right for content that changes every turn (the date), keeping
 * that volatile value on the uncached tail.
 */
export function injectSystemReminder(
  messages: UIMessage[],
  inner: string,
  opts: { anchor?: 'first' | 'last' } = {},
): UIMessage[] {
  const isUser = (m: UIMessage): boolean => m.role === 'user';
  const idx = opts.anchor === 'last' ? messages.findLastIndex(isUser) : messages.findIndex(isUser);
  if (idx < 0) return messages;

  const text = `<system-reminder>\n${inner}\n</system-reminder>`;
  const target = messages[idx];
  const injected: UIMessage = { ...target, parts: [{ type: 'text', text }, ...target.parts] };
  return [...messages.slice(0, idx), injected, ...messages.slice(idx + 1)];
}
