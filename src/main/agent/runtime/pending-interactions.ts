import { randomUUID } from 'node:crypto';
import type { ToolCall } from '@earendil-works/pi-ai';
import { Refusal } from '@main/utils/refusal';
import type {
  DecideInteraction,
  InteractionDecision,
  InteractionKind,
  InteractionOutcome,
  InteractionRequest,
  RunStopReason,
} from '@shared/interactions';

/** The interaction a decision names is not open: another run, already settled, or never asked. */
export class InteractionConflict extends Refusal {
  constructor(message: string) {
    super('collision', message);
  }
}

/** The decision does not fit the interaction it names. */
export class InvalidInteractionDecision extends Refusal {
  constructor(message: string) {
    super('unacceptable', message);
  }
}

export type OpenInteraction = {
  request: InteractionRequest;
  response: Promise<InteractionOutcome>;
  /** Withdraw this request alone, when it could not be recorded. */
  cancel(): void;
};

const STOP_REASONS = new Set<unknown>([
  'user_cancelled',
  'clarification_cancelled',
  'app_shutdown',
  'interrupted',
]);

/** A stop reason the run set, or plain interruption when it is anything else. */
export const stopReasonOf = (reason: unknown): RunStopReason =>
  STOP_REASONS.has(reason) ? (reason as RunStopReason) : 'interrupted';

const DECISIONS: Record<InteractionKind, InteractionDecision['kind'][]> = {
  approval: ['approved', 'denied'],
  clarification: ['answered', 'cancelled'],
};

function questionCount(call: ToolCall): number {
  const { questions } = call.arguments as { questions?: unknown };
  return Array.isArray(questions) ? questions.length : 0;
}

/**
 * The requests one run is waiting on, and the race between a decision and the
 * run stopping. Each request settles exactly once: a decision is moved out of
 * the waiting set before anything awaits, so a stop that lands a moment later
 * can no longer take it. Holds no storage — recording is the caller's job.
 */
export class PendingInteractions {
  private readonly runId: string;
  private readonly abort: AbortController;
  private readonly signal: AbortSignal;
  /** The requests still waiting on the user, settled once and then dropped. */
  private readonly waiting = new Map<
    string,
    { request: InteractionRequest; settle: (outcome: InteractionOutcome) => void }
  >();
  /** Kept until the run ends so a retried decision is recognised instead of conflicting. */
  private readonly accepted = new Map<string, InteractionDecision>();
  private firstFailure: Error | undefined;

  private readonly onAbort = (): void => {
    this.interrupt(stopReasonOf(this.signal.reason));
  };

  constructor(opts: { runId: string; abort: AbortController }) {
    this.runId = opts.runId;
    this.abort = opts.abort;
    this.signal = opts.abort.signal;
    this.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  /** The first internal failure, kept even when the run was already cancelled. */
  get failure(): Error | undefined {
    return this.firstFailure;
  }

  private interrupt(reason: RunStopReason): void {
    for (const entry of this.waiting.values()) entry.settle({ kind: 'interrupted', reason });
    this.waiting.clear();
  }

  open(kind: InteractionKind, toolCall: ToolCall): OpenInteraction {
    const request: InteractionRequest = {
      id: randomUUID(),
      runId: this.runId,
      kind,
      toolCall,
      createdAt: Date.now(),
    };
    if (this.signal.aborted) {
      const reason = stopReasonOf(this.signal.reason);
      return {
        request,
        response: Promise.resolve({ kind: 'interrupted', reason }),
        cancel: () => {},
      };
    }
    let settle!: (outcome: InteractionOutcome) => void;
    const response = new Promise<InteractionOutcome>((resolve) => {
      settle = resolve;
    });
    this.waiting.set(request.id, { request, settle });
    return {
      request,
      response,
      cancel: () => {
        if (this.waiting.delete(request.id)) settle({ kind: 'interrupted', reason: 'interrupted' });
      },
    };
  }

  respond({ runId, interactionId, decision }: DecideInteraction): 'accepted' | 'already_accepted' {
    if (runId !== this.runId) {
      throw new InteractionConflict('The interaction belongs to another run.');
    }
    const previous = this.accepted.get(interactionId);
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(decision)) return 'already_accepted';
      throw new InteractionConflict('A different decision was already accepted.');
    }
    const entry = this.waiting.get(interactionId);
    if (!entry) throw new InteractionConflict('The interaction is no longer active.');
    const { kind, toolCall } = entry.request;
    if (!DECISIONS[kind].includes(decision.kind)) {
      throw new InvalidInteractionDecision(`A ${kind} cannot be ${decision.kind}.`);
    }
    if (decision.kind === 'answered' && decision.answers.length !== questionCount(toolCall)) {
      throw new InvalidInteractionDecision('The answers do not match the questions asked.');
    }
    this.waiting.delete(interactionId);
    this.accepted.set(interactionId, decision);
    entry.settle(decision);
    // Taking the question back ends the turn, so no other call slips into execution.
    if (decision.kind === 'cancelled') this.abort.abort('clarification_cancelled');
    return 'accepted';
  }

  cancel(reason: RunStopReason | Error): void {
    if (reason instanceof Error) this.firstFailure ??= reason;
    this.abort.abort(reason);
  }

  dispose(): void {
    this.signal.removeEventListener('abort', this.onAbort);
    this.interrupt('interrupted');
    this.accepted.clear();
  }
}
