import { randomUUID } from 'node:crypto';
import type { ToolCall } from '@earendil-works/pi-ai';
import type { SessionRecorder } from '@main/conversation/session-recorder';
import type { AgentSessionEvent } from '@shared/protocol';
import type { approvalGate } from '../../permissions';
import type { ParkedCall } from '../tool-resolutions';
import type { Capability } from './compose';

export function toolInteractions(opts: {
  clientSide: Set<string>;
  gate: ReturnType<typeof approvalGate>;
  recorder: SessionRecorder;
  parked: Map<string, ParkedCall>;
  emit: (event: AgentSessionEvent) => void;
}): Capability {
  const park = async (call: ToolCall, approvalId?: string) => {
    opts.parked.set(call.id, { toolCallId: call.id, toolName: call.name, approvalId });
    await opts.recorder.park({ toolCallId: call.id, approvalId });
    return {
      block: true,
      terminate: true,
      reason: 'Paused: waiting for the user. The turn ends here.',
    };
  };
  return {
    name: 'tool-interactions',
    beforeToolCall: async ({ toolCall, args }) => {
      if (opts.clientSide.has(toolCall.name)) return park(toolCall);
      if (!(await opts.gate(toolCall.name, args, toolCall.id))) return undefined;
      const approvalId = randomUUID();
      opts.emit({ type: 'approval_requested', approvalId, toolCallId: toolCall.id });
      return park(toolCall, approvalId);
    },
    shouldStopAfterTurn: () => opts.parked.size > 0,
  };
}
