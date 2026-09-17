import type { ToolCall } from '@earendil-works/pi-ai';
import { z } from 'zod';

/**
 * What a run asks the user while it waits, and what the user can answer. The
 * request carries the original tool call, so a decision can only settle that
 * call — never change which tool runs or with what arguments.
 */

export const interactionDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approved') }),
  z.strictObject({ kind: z.literal('denied'), reason: z.string().max(2000).optional() }),
  z.strictObject({
    kind: z.literal('answered'),
    answers: z.array(z.string().max(8000)).min(1).max(4),
  }),
  z.strictObject({ kind: z.literal('cancelled') }),
]);

export const decideInteractionSchema = z.strictObject({
  runId: z.string().min(1),
  interactionId: z.uuid(),
  decision: interactionDecisionSchema,
});

export type InteractionDecision = z.infer<typeof interactionDecisionSchema>;
export type DecideInteraction = z.infer<typeof decideInteractionSchema>;

export type RunStopReason =
  | 'user_cancelled'
  | 'clarification_cancelled'
  | 'app_shutdown'
  | 'interrupted';

export type InteractionOutcome =
  | InteractionDecision
  | { kind: 'interrupted'; reason: RunStopReason };

export type InteractionKind = 'approval' | 'clarification';

export type InteractionRequest = {
  id: string;
  runId: string;
  kind: InteractionKind;
  toolCall: ToolCall;
  createdAt: number;
};

export type InteractionEvent =
  | { type: 'interaction_requested'; request: InteractionRequest }
  | { type: 'interaction_resolved'; request: InteractionRequest; outcome: InteractionOutcome };
