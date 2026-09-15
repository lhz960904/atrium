import { randomUUID } from 'node:crypto';
import type { ToolCall } from '@earendil-works/pi-ai';
import type {
  DecideInteraction,
  InteractionDecision,
  InteractionKind,
  InteractionOutcome,
  InteractionRequest,
  RunStopReason,
} from '@shared/interactions';

/** The interaction a decision names is not open: another run, already settled, or never asked. */
export class InteractionConflict extends Error {}

/** The decision does not fit the interaction it names. */
export class InvalidInteractionDecision extends Error {}

export type OpenInteraction = {
  request: InteractionRequest;
  response: Promise<InteractionOutcome>;
  /** Withdraw this request alone, when it could not be recorded. */
  cancel(): void;
};

export type PendingInteractions = {
  /** The first internal failure, kept even when the run was already cancelled. */
  readonly failure: Error | undefined;
  open(kind: InteractionKind, toolCall: ToolCall): OpenInteraction;
  respond(input: DecideInteraction): 'accepted' | 'already_accepted';
  cancel(reason: RunStopReason | Error): void;
  dispose(): void;
};

const STOP_REASONS = new Set<unknown>([
  'user_cancelled',
  'clarification_cancelled',
  'app_shutdown',
  'interrupted',
]);

const stopReasonOf = (reason: unknown): RunStopReason =>
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
 * the open set before anything awaits, so a stop that lands a moment later can
 * no longer take it. Holds no storage — recording is the caller's job.
 */
export function createPendingInteractions(opts: {
  runId: string;
  abort: AbortController;
}): PendingInteractions {
  const { signal } = opts.abort;
  const open = new Map<
    string,
    { request: InteractionRequest; settle: (outcome: InteractionOutcome) => void }
  >();
  // Kept until the run ends so a retried decision is recognised instead of conflicting.
  const accepted = new Map<string, InteractionDecision>();
  let failure: Error | undefined;

  const interrupt = (reason: RunStopReason) => {
    for (const entry of open.values()) entry.settle({ kind: 'interrupted', reason });
    open.clear();
  };
  const onAbort = () => interrupt(stopReasonOf(signal.reason));
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    get failure() {
      return failure;
    },

    open(kind, toolCall) {
      const request: InteractionRequest = {
        id: randomUUID(),
        runId: opts.runId,
        kind,
        toolCall,
        createdAt: Date.now(),
      };
      if (signal.aborted) {
        const reason = stopReasonOf(signal.reason);
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
      open.set(request.id, { request, settle });
      return {
        request,
        response,
        cancel() {
          if (open.delete(request.id)) settle({ kind: 'interrupted', reason: 'interrupted' });
        },
      };
    },

    respond({ runId, interactionId, decision }) {
      if (runId !== opts.runId) {
        throw new InteractionConflict('The interaction belongs to another run.');
      }
      const previous = accepted.get(interactionId);
      if (previous) {
        if (JSON.stringify(previous) === JSON.stringify(decision)) return 'already_accepted';
        throw new InteractionConflict('A different decision was already accepted.');
      }
      const entry = open.get(interactionId);
      if (!entry) throw new InteractionConflict('The interaction is no longer active.');
      const { kind, toolCall } = entry.request;
      if (!DECISIONS[kind].includes(decision.kind)) {
        throw new InvalidInteractionDecision(`A ${kind} cannot be ${decision.kind}.`);
      }
      if (decision.kind === 'answered' && decision.answers.length !== questionCount(toolCall)) {
        throw new InvalidInteractionDecision('The answers do not match the questions asked.');
      }
      open.delete(interactionId);
      accepted.set(interactionId, decision);
      entry.settle(decision);
      // Taking the question back ends the turn, so no other call slips into execution.
      if (decision.kind === 'cancelled') opts.abort.abort('clarification_cancelled');
      return 'accepted';
    },

    cancel(reason) {
      if (reason instanceof Error) failure ??= reason;
      opts.abort.abort(reason);
    },

    dispose() {
      signal.removeEventListener('abort', onAbort);
      interrupt('interrupted');
      accepted.clear();
    },
  };
}
