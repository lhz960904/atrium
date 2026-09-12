import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@shared/protocol';

/**
 * The one boundary between pi's message types and the frozen copy we store and
 * put on the wire. They differ only in width — the frozen copy widens assistant
 * content so unknown block types survive a round-trip — which makes them
 * structurally compatible but not mutually assignable. Every crossing goes
 * through here rather than growing casts at each call site.
 */

export const asStored = (messages: AgentMessage[]): Message[] => messages as unknown as Message[];

export const asPi = (messages: Message[]): AgentMessage[] => messages as unknown as AgentMessage[];

export const storedMessage = (message: AgentMessage): Message => message as unknown as Message;
