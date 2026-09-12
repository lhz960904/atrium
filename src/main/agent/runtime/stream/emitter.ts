import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@shared/protocol';
import type { ParkedCall } from '../approvals';
import { projectAgentEvent } from './projector';
import { withErrorText } from './tool-result';

/**
 * Put a run's engine events on the wire. Everything here is a decision about
 * what a *reader* should see, which is why it is separate from what the run
 * stores: the two disagree on purpose in a couple of places.
 */
export function wireEmitter(opts: {
  runId: string;
  /** Calls handed back to the user; their cards are showing the ask. */
  parked: Map<string, ParkedCall>;
  emit: (event: AgentSessionEvent) => void;
}): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    // The run emits its own agent_end once its bookkeeping is done, so that the
    // wire's promise — agent_end is the last event — stays literally true.
    if (event.type === 'agent_end') return;
    const projected = projectAgentEvent(event, opts.runId);
    if (!projected) return;
    // pi announces every appended message; only assistant turns belong on the
    // wire — tool results arrive as tool_execution_end, and the user's message
    // is what started the run.
    if (
      (projected.type === 'message_start' || projected.type === 'message_end') &&
      projected.message.role !== 'assistant'
    ) {
      return;
    }
    if (projected.type === 'tool_execution_end') {
      // A parked call produced no result — the card is showing the ask, and a
      // refusal frame would replace it with an error the user never caused.
      if (opts.parked.has(projected.toolCallId)) return;
      projected.result.details = withErrorText(
        projected.result.details,
        projected.result.content,
        projected.isError,
      );
    }
    opts.emit(projected);
  };
}
