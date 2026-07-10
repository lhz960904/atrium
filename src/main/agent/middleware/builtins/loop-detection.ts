import type { ModelMessage, ToolCallPart } from 'ai';
import { createLogger } from '../../../log';
import type { AgentMiddleware, RunContext, StepInfo, StepOverride } from '../types';

const log = createLogger('loop-detection');

const DEFAULT_WARN_AT = 3;
const DEFAULT_STOP_AT = 5;

const SCRATCH_KEY = 'loop-detection:state';

type LoopState = {
  /** toolCallIds already tallied, seeded with pre-run history so it isn't counted. */
  counted: Set<string>;
  /** Identical-call key → times the model made that exact call this run. */
  counts: Map<string, number>;
  /** Keys already warned about — one warning each, then only the hard stop is left. */
  warned: Set<string>;
  /** Set when the hard limit trips; every remaining step stays text-only. */
  stopNotice: string | null;
};

export type LoopDetectionOptions = {
  /** Identical calls before a warning is injected, default 3. */
  warnAt?: number;
  /** Identical calls before tool use is cut off for the turn, default 5. */
  stopAt?: number;
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

function toolCallsOf(messages: ModelMessage[]): ToolCallPart[] {
  const calls: ToolCallPart[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    for (const part of m.content) {
      if (part.type === 'tool-call') calls.push(part);
    }
  }
  return calls;
}

/**
 * Breaks repetitive tool-call loops. A model that keeps making the exact same
 * call (same tool, same arguments) is stuck — typically a weak model re-issuing
 * a hallucinated tool name after every error — and without intervention the
 * only brake is the run's step cap. Detection scans the step's assistant
 * tool-call parts rather than hooking beforeToolUse, because a call to a
 * nonexistent tool fails name resolution before execution and would never
 * reach the tool hooks. At `warnAt` repeats a one-off reminder is appended
 * after the tool results; at `stopAt` tool choice is forced to 'none' for the
 * rest of the turn so the model must wrap up in text. Both injections are
 * per-step message overrides — transient by design, never persisted.
 */
export function loopDetectionMiddleware(options: LoopDetectionOptions = {}): AgentMiddleware {
  const warnAt = options.warnAt ?? DEFAULT_WARN_AT;
  const stopAt = options.stopAt ?? DEFAULT_STOP_AT;

  return {
    name: 'loop-detection',
    beforeStep(ctx: RunContext, { messages }: StepInfo): StepOverride | undefined {
      const state = ctx.scratch.get(SCRATCH_KEY) as LoopState | undefined;
      if (!state) {
        // First step: everything in view predates this run. Seed it uncounted
        // so a call the user legitimately re-asked for across turns starts at
        // zero instead of inheriting its history.
        ctx.scratch.set(SCRATCH_KEY, {
          counted: new Set(toolCallsOf(messages).map((c) => c.toolCallId)),
          counts: new Map(),
          warned: new Set(),
          stopNotice: null,
        } satisfies LoopState);
        return undefined;
      }

      const warnings: string[] = [];
      for (const call of toolCallsOf(messages)) {
        if (state.counted.has(call.toolCallId)) continue;
        state.counted.add(call.toolCallId);
        const key = `${call.toolName}:${stableStringify(call.input)}`;
        const n = (state.counts.get(key) ?? 0) + 1;
        state.counts.set(key, n);
        if (n >= stopAt) {
          if (!state.stopNotice) {
            state.stopNotice = stopNotice(call.toolName, n);
            log.warn(`hard stop: ${call.toolName} repeated ${n}x with identical input`);
          }
        } else if (n >= warnAt && !state.warned.has(key)) {
          state.warned.add(key);
          warnings.push(warnNotice(call.toolName, n));
          log.info(`warning injected: ${call.toolName} repeated ${n}x with identical input`);
        }
      }

      if (state.stopNotice) {
        return {
          messages: [...messages, { role: 'user', content: state.stopNotice }],
          toolChoice: 'none',
        };
      }
      if (warnings.length > 0) {
        return { messages: [...messages, { role: 'user', content: warnings.join('\n\n') }] };
      }
      return undefined;
    },
  };
}
