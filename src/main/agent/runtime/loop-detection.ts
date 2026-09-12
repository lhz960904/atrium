import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { createLogger } from '@main/utils/log';
import type { AssistantMessage, ToolCall } from '@shared/protocol';
import type { ContextTransform } from './context/compose';

const log = createLogger('loop-detection');

const DEFAULT_WARN_AT = 3;
const DEFAULT_STOP_AT = 5;

export type LoopDetectionOptions = {
  /** Identical calls before a warning is injected, default 3. */
  warnAt?: number;
  /** Identical calls before tool use is cut off for the turn, default 5. */
  stopAt?: number;
};

export type LoopDetector = {
  /** Tally the calls a finished turn made. */
  observe(message: AssistantMessage): void;
  /** True once the hard limit tripped — no tool may be offered for the rest of the run. */
  readonly stopped: boolean;
  /** Appends whichever notice the tally has earned to the model's view. */
  transform: ContextTransform;
};

const warnNotice = (name: string, count: number): string =>
  `<system-reminder>You have made the exact same ${name} call (identical arguments) ${count} times this turn. Repeating it will not change the outcome. Re-read the tool's last output carefully and change your approach: different arguments, a different tool, or ask the user how to proceed.</system-reminder>`;

const stopNotice = (name: string, count: number): string =>
  `<system-reminder>Loop detected: the exact same ${name} call was repeated ${count} times without progress, so tool use is disabled for the rest of this turn. Summarize what you were trying to do, what kept failing, and what you need to continue.</system-reminder>`;

/** JSON.stringify with recursively sorted object keys, so two inputs that differ
 *  only in property order produce the same identical-call key. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

const note = (text: string): AgentMessage => ({
  role: 'user',
  content: text,
  timestamp: Date.now(),
});

/**
 * Breaks repetitive tool-call loops. A model that keeps making the exact same
 * call (same tool, same arguments) is stuck — typically a weak model re-issuing
 * a hallucinated tool name after every error — and without intervention the only
 * brake is the run's turn cap. The tally reads each finished turn's assistant
 * message rather than hooking tool execution, because a call to a nonexistent
 * tool fails name resolution before execution and would never reach the tool
 * hooks. At `warnAt` repeats a one-off reminder is appended after the tool
 * results; at `stopAt` the run stops offering tools at all, so the model has to
 * wrap up in text. Both notices ride on the per-request view — transient by
 * design, never persisted.
 */
export function createLoopDetector(options: LoopDetectionOptions = {}): LoopDetector {
  const warnAt = options.warnAt ?? DEFAULT_WARN_AT;
  const stopAt = options.stopAt ?? DEFAULT_STOP_AT;

  const counts = new Map<string, number>();
  const warned = new Set<string>();
  let pending: string[] = [];
  let stop: string | null = null;

  return {
    observe(message: AssistantMessage): void {
      for (const content of message.content) {
        if (content.type !== 'toolCall') continue;
        const call = content as ToolCall;
        const key = `${call.name}:${stableStringify(call.arguments)}`;
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        if (n >= stopAt) {
          if (!stop) {
            stop = stopNotice(call.name, n);
            log.warn(`hard stop: ${call.name} repeated ${n}x with identical input`);
          }
        } else if (n >= warnAt && !warned.has(key)) {
          warned.add(key);
          pending.push(warnNotice(call.name, n));
          log.info(`warning injected: ${call.name} repeated ${n}x with identical input`);
        }
      }
    },

    get stopped(): boolean {
      return stop !== null;
    },

    transform(messages: AgentMessage[]): AgentMessage[] {
      if (stop) return [...messages, note(stop)];
      if (pending.length === 0) return messages;
      const warning = note(pending.join('\n\n'));
      pending = [];
      return [...messages, warning];
    },
  };
}
