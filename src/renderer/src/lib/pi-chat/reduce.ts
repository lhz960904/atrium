import type { AtriumUIMessage } from '@shared/chat';
import type { InteractionOutcome, InteractionRequest } from '@shared/interactions';
import { isMcpToolName } from '@shared/mcp';
import type {
  AgentSessionEvent,
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
  ToolExecutionResult,
} from '@shared/protocol';
import { contentText } from '@shared/protocol';

/**
 * Rebuilds the run's assistant message, in the exact part shape the existing
 * chat components consume, from the pi event stream. This is the renderer half
 * of the protocol isolation: the wire speaks pi events, while ChatThread and
 * friends keep reading AtriumUIMessage parts untouched.
 *
 * pi turns append into ONE message per run (matching how a run has always been
 * one assistant row): each message_start after the first contributes a
 * step-start part, mirroring the old per-step markers. Tool results surface
 * the engine output carried verbatim in `details`, so tool cards render the
 * same payloads they always did.
 */

export type RunSnapshot = {
  message: AtriumUIMessage | null;
  status: 'streaming' | 'done';
  /** Stream-level failure for the chat view's error banner. */
  error?: string;
};

type Part = AtriumUIMessage['parts'][number];
type LoosePart = Record<string, unknown>;

const toolPartType = (name: string) => (isMcpToolName(name) ? 'dynamic-tool' : `tool-${name}`);

function makeToolPart(name: string, toolCallId: string): LoosePart {
  const part: LoosePart = { type: toolPartType(name), toolCallId, state: 'input-streaming' };
  if (part.type === 'dynamic-tool') part.toolName = name;
  return part;
}

export class RunAssembler {
  private parts: Part[] = [];
  private id = '';
  private metadata: Record<string, unknown> = {};
  private started = false;
  private ended = false;
  private failure: string | undefined;
  /** Current turn's contentIndex → parts index; reset every message_start. */
  private turnParts = new Map<number, number>();
  /** toolCallId → parts index, run-wide (executions outlive their turn). */
  private toolParts = new Map<string, number>();
  /** What the run asked the user, by request id; a settled one carries its outcome. */
  private interactions = new Map<
    string,
    { request: InteractionRequest; outcome?: InteractionOutcome }
  >();
  /** Calls the user denied: the error pi stands in for them must not replace the denial. */
  private denied = new Set<string>();

  apply(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'run_started':
        this.id = event.runId;
        break;
      case 'message_start': {
        // Mirror the old per-step markers (every step opened with one).
        this.parts.push({ type: 'step-start' });
        this.started = true;
        this.turnParts = new Map();
        break;
      }
      case 'message_update':
        this.applyUpdate(event.assistantMessageEvent);
        break;
      case 'message_end': {
        this.syncTurn(event.message as AssistantMessage);
        break;
      }
      case 'tool_execution_update': {
        const result = event.partialResult as ToolExecutionResult;
        this.patchTool(event.toolCallId, event.toolName, {
          state: 'output-available',
          output: result?.details,
          preliminary: true,
        });
        break;
      }
      case 'tool_execution_end': {
        this.endTool(event.toolCallId, event.toolName, event.result, event.isError);
        break;
      }
      case 'interaction_requested':
        this.interactions.set(event.request.id, { request: event.request });
        this.applyRequest(event.request);
        break;
      case 'interaction_resolved':
        this.interactions.set(event.request.id, {
          request: event.request,
          outcome: event.outcome,
        });
        this.applyOutcome(event.request, event.outcome);
        break;
      case 'notice':
        this.applyNotice(event.name, event.payload);
        break;
      case 'agent_end':
        // The loop is done, but the run's persistence and cleanup are not.
        break;
      case 'run_finished':
        this.ended = true;
        if (event.status === 'failed') this.failure = event.error;
        break;
      default:
        // turn brackets carry no render state; unknown events are future protocol.
        break;
    }
  }

  /** A request the run is still waiting on, by its id. */
  openInteraction(id: string): InteractionRequest | undefined {
    const entry = this.interactions.get(id);
    return entry && !entry.outcome ? entry.request : undefined;
  }

  /** The request still waiting on a tool call. */
  openInteractionForTool(toolCallId: string): InteractionRequest | undefined {
    for (const { request, outcome } of this.interactions.values()) {
      if (!outcome && request.toolCall.id === toolCallId) return request;
    }
    return undefined;
  }

  snapshot(): RunSnapshot {
    return {
      message: this.started
        ? {
            id: this.id,
            role: 'assistant',
            parts: [...this.parts],
            metadata: this.metadata as AtriumUIMessage['metadata'],
          }
        : null,
      status: this.ended ? 'done' : 'streaming',
      error: this.failure,
    };
  }

  private applyUpdate(update: AssistantMessageEvent): void {
    switch (update.type) {
      case 'text_start':
        this.openBlock(update.contentIndex, { type: 'text', text: '', state: 'streaming' });
        break;
      case 'text_delta':
        this.patchBlock(update.contentIndex, (part) => ({
          ...part,
          text: String(part.text ?? '') + update.delta,
        }));
        break;
      case 'text_end':
        this.patchBlock(update.contentIndex, (part) => ({
          ...part,
          text: update.content,
          state: 'done',
        }));
        break;
      case 'thinking_start':
        this.openBlock(update.contentIndex, { type: 'reasoning', text: '', state: 'streaming' });
        break;
      case 'thinking_delta':
        this.patchBlock(update.contentIndex, (part) => ({
          ...part,
          text: String(part.text ?? '') + update.delta,
        }));
        break;
      case 'thinking_end':
        this.patchBlock(update.contentIndex, (part) => ({
          ...part,
          text: update.content,
          state: 'done',
        }));
        break;
      case 'toolcall_start': {
        const index = this.openBlock(
          update.contentIndex,
          makeToolPart(update.toolName, update.toolCallId) as Part,
        );
        this.toolParts.set(update.toolCallId, index);
        break;
      }
      case 'toolcall_end': {
        const call = update.toolCall;
        let index = this.toolParts.get(call.id);
        if (index === undefined) {
          index = this.openBlock(update.contentIndex, makeToolPart(call.name, call.id) as Part);
          this.toolParts.set(call.id, index);
        }
        this.setPart(index, (part) => ({
          ...part,
          state: 'input-available',
          input: call.arguments,
        }));
        break;
      }
      default:
        // start/done/error carry no part content; message_end is authoritative.
        break;
    }
  }

  /** message_end is authoritative for the turn's model content — reconcile any
   *  drift between accumulated deltas and the final text/thinking/toolCall. */
  private syncTurn(message: AssistantMessage): void {
    message.content.forEach((content, contentIndex) => {
      if (content.type === 'text') {
        this.patchBlock(contentIndex, (part) => ({ ...part, text: content.text, state: 'done' }));
      } else if (content.type === 'thinking') {
        this.patchBlock(contentIndex, (part) => ({
          ...part,
          text: content.thinking,
          state: 'done',
        }));
      } else if (content.type === 'toolCall') {
        // The forward-compat Content union keeps `id` unknown; this branch is the known shape.
        const call = content as ToolCall;
        const index = this.toolParts.get(call.id);
        if (index !== undefined) {
          this.setPart(index, (part) =>
            part.state === 'input-streaming'
              ? { ...part, state: 'input-available', input: call.arguments }
              : part,
          );
        }
      }
    });
    // A run the user stopped ends aborted; only a provider error is a failure to report.
    if (message.stopReason === 'error' && message.errorMessage) this.failure = message.errorMessage;
  }

  private applyRequest(request: InteractionRequest): void {
    const call = request.toolCall;
    // A call this client never saw streamed still needs its input on the card.
    if (!this.toolParts.has(call.id)) this.patchTool(call.id, call.name, { input: call.arguments });
    if (request.kind === 'approval') {
      this.patchTool(call.id, call.name, {
        state: 'approval-requested',
        approval: { id: request.id },
      });
    }
  }

  /** A decision only settles the ask; whether the tool worked arrives with its result. */
  private applyOutcome(request: InteractionRequest, outcome: InteractionOutcome): void {
    if (request.kind !== 'approval') return;
    const { id: toolCallId, name } = request.toolCall;
    const approval = { id: request.id };
    if (outcome.kind === 'approved') {
      this.patchTool(toolCallId, name, {
        state: 'approval-responded',
        approval: { ...approval, approved: true },
      });
    } else if (outcome.kind === 'denied') {
      this.denied.add(toolCallId);
      this.patchTool(toolCallId, name, {
        state: 'output-denied',
        approval: {
          ...approval,
          approved: false,
          ...(outcome.reason && { reason: outcome.reason }),
        },
      });
    } else if (outcome.kind === 'interrupted') {
      this.patchTool(toolCallId, name, {
        state: 'output-error',
        errorText: 'The run stopped before this call was decided.',
      });
    }
  }

  private endTool(
    toolCallId: string,
    toolName: string,
    result: ToolExecutionResult,
    isError: boolean,
  ): void {
    if (!isError) {
      this.patchTool(toolCallId, toolName, {
        state: 'output-available',
        output: result?.details,
        preliminary: undefined,
      });
      return;
    }
    if (this.denied.has(toolCallId)) return;
    this.patchTool(toolCallId, toolName, {
      state: 'output-error',
      errorText: contentText(result.content).trim() || 'Tool failed.',
    });
  }

  private applyNotice(name: string, payload: unknown): void {
    if (name === 'message-metadata' && payload && typeof payload === 'object') {
      this.metadata = { ...this.metadata, ...(payload as Record<string, unknown>) };
    } else if (name === 'file' && payload && typeof payload === 'object') {
      const file = payload as { url?: string; mediaType?: string };
      this.parts.push({
        type: 'file',
        url: file.url ?? '',
        mediaType: file.mediaType ?? '',
      } as Part);
    }
    // Other notices (title, compaction, subagent…) are side-effect channels the
    // chat store routes to their own stores; they never enter the message.
  }

  /** Insert a new part for a turn content block and index it. */
  private openBlock(contentIndex: number, part: Part): number {
    const index = this.parts.length;
    this.parts.push(part);
    this.turnParts.set(contentIndex, index);
    return index;
  }

  private patchBlock(contentIndex: number, patch: (part: LoosePart) => LoosePart): void {
    const index = this.turnParts.get(contentIndex);
    if (index === undefined) return;
    this.setPart(index, patch);
  }

  private patchTool(toolCallId: string, toolName: string | undefined, fields: LoosePart): void {
    let index = this.toolParts.get(toolCallId);
    if (index === undefined) {
      // Execution event for a call this client never saw streamed (defensive);
      // materialize the part so the result still renders.
      if (toolName === undefined) return;
      index = this.parts.length;
      this.parts.push({
        ...makeToolPart(toolName, toolCallId),
        state: 'input-available',
        input: {},
      } as Part);
      this.toolParts.set(toolCallId, index);
    }
    this.setPart(index, (part) => ({ ...part, ...fields }));
  }

  /** Every mutation replaces the part object, so memoized components see a new
   *  reference exactly when content changed. */
  private setPart(index: number, patch: (part: LoosePart) => LoosePart): void {
    const next = patch(this.parts[index] as LoosePart);
    if (next !== (this.parts[index] as LoosePart)) this.parts[index] = next as Part;
  }
}
