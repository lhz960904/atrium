import type { UIMessage } from 'ai';

// On the user message (not the system prompt) so a changing index keeps the prompt cache.
// Cloned, not mutated, so it never leaks into the persisted/UI messages.
export function injectSystemReminder(messages: UIMessage[], inner: string): UIMessage[] {
  const idx = messages.findIndex((m) => m.role === 'user');
  if (idx < 0) return messages;

  const text = `<system-reminder>\n${inner}\n</system-reminder>`;
  const target = messages[idx];
  const injected: UIMessage = { ...target, parts: [{ type: 'text', text }, ...target.parts] };
  return [...messages.slice(0, idx), injected, ...messages.slice(idx + 1)];
}
