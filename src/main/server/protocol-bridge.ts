import type {
  AgentSessionEvent,
  AssistantMessage,
  Content,
  ToolCall,
  ToolExecutionResult,
  Usage,
} from '@shared/protocol';
import type { UIMessageChunk } from 'ai';

/**
 * Edge converter from the AI SDK's UIMessageChunk stream to the frozen pi
 * event vocabulary. Throwaway: it exists so the wire and the renderer can move
 * to pi events while the AI SDK still runs the model side; the engine swap
 * deletes it by emitting pi events natively.
 *
 * Structural mapping: one AI SDK run streams a single UIMessage across many
 * steps, while pi gives each step its own assistant message — so `start-step`
 * opens a turn + message, and the first tool output (execution begins only
 * after the model's message is complete) or `finish-step` closes it. Every
 * step's message_start/message_end carries the run-level UIMessage id, since
 * that is the key persistence and the renderer reconcile against.
 *
 * Tool results put the engine's output verbatim in `details` and leave
 * `content` empty: content is the model-facing projection, and while the AI
 * SDK owns the model side nothing reads it — projecting would only duplicate
 * megabyte screenshots onto the wire.
 *
 * One instance per run. Closure is guaranteed: whatever the engine stream did,
 * push() + finalize() end every open tool execution, message, and turn, and
 * the last event is always agent_end.
 */

type Bridge = {
  push(chunk: UIMessageChunk): AgentSessionEvent[];
  finalize(): AgentSessionEvent[];
};

type OpenBlock = { index: number; text: string };
type OpenToolCall = { index: number; name: string; args: Record<string, unknown> };

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const asArgs = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

/** Turn-total token counts stamped by the metadata middleware on `finish`. */
type MetadataTokens = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
};

function usageFromMetadata(md: MetadataTokens): Usage {
  return {
    input: md.inputTokens ?? 0,
    output: md.outputTokens ?? 0,
    cacheRead: md.cacheReadTokens ?? 0,
    cacheWrite: md.cacheCreationTokens ?? 0,
    totalTokens: md.totalTokens ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function createProtocolBridge(init: {
  provider: string;
  model: string;
  now?: () => number;
}): Bridge {
  const now = init.now ?? Date.now;

  let agentStarted = false;
  let agentEnded = false;
  let turnOpen = false;
  let messageId = '';
  let message: AssistantMessage | null = null;
  let contentIndex = 0;
  // AI SDK text/reasoning blocks are keyed by part id, tool blocks by call id.
  let textBlocks = new Map<string, OpenBlock>();
  let toolCalls = new Map<string, OpenToolCall>();
  const executing = new Map<string, { name: string; args: Record<string, unknown> }>();

  function openMessage(out: AgentSessionEvent[]) {
    message = {
      role: 'assistant',
      content: [],
      api: 'ai-sdk',
      provider: init.provider,
      model: init.model,
      usage: zeroUsage(),
      stopReason: 'pending',
      timestamp: now(),
    };
    contentIndex = 0;
    textBlocks = new Map();
    toolCalls = new Map();
    out.push({ type: 'message_start', message, messageId });
    out.push({ type: 'message_update', assistantMessageEvent: { type: 'start' } });
  }

  function closeMessage(
    out: AgentSessionEvent[],
    end:
      | { kind: 'done'; reason: 'stop' | 'length' | 'toolUse' | 'deferred' }
      | { kind: 'error'; reason: 'aborted' | 'error'; errorMessage?: string },
  ) {
    if (!message) return;
    message.stopReason = end.reason;
    if (end.kind === 'done') {
      out.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'done', reason: end.reason, usage: message.usage },
      });
    } else {
      if (end.errorMessage) message.errorMessage = end.errorMessage;
      out.push({
        type: 'message_update',
        assistantMessageEvent: { type: 'error', reason: end.reason },
      });
    }
    out.push({ type: 'message_end', message, messageId });
    message = null;
  }

  /** Execution begins only after the model's message is complete — close it. */
  function ensureExecuting(out: AgentSessionEvent[], toolCallId: string, toolName?: string) {
    if (message) closeMessage(out, { kind: 'done', reason: 'toolUse' });
    if (executing.has(toolCallId)) return;
    const call = toolCalls.get(toolCallId);
    const name = toolName ?? call?.name ?? 'unknown';
    const args = call?.args ?? {};
    executing.set(toolCallId, { name, args });
    out.push({ type: 'tool_execution_start', toolCallId, toolName: name, args });
  }

  function endExecution(
    out: AgentSessionEvent[],
    toolCallId: string,
    result: ToolExecutionResult,
    isError: boolean,
  ) {
    ensureExecuting(out, toolCallId);
    const toolName = executing.get(toolCallId)?.name ?? 'unknown';
    executing.delete(toolCallId);
    out.push({ type: 'tool_execution_end', toolCallId, toolName, result, isError });
  }

  function closeTurn(out: AgentSessionEvent[]) {
    if (!turnOpen) return;
    turnOpen = false;
    out.push({ type: 'turn_end' });
  }

  function closeAgent(out: AgentSessionEvent[]) {
    if (agentEnded || !agentStarted) return;
    agentEnded = true;
    out.push({ type: 'agent_end', willRetry: false });
  }

  /** Abort every open construct, innermost first; used by abort/finalize. */
  function closeAll(out: AgentSessionEvent[], errorMessage?: string) {
    for (const toolCallId of [...executing.keys()]) {
      endExecution(out, toolCallId, { content: [], details: { aborted: true } }, true);
    }
    closeMessage(out, { kind: 'error', reason: 'aborted', errorMessage });
    closeTurn(out);
    closeAgent(out);
  }

  function push(chunk: UIMessageChunk): AgentSessionEvent[] {
    if (agentEnded) return [];
    const out: AgentSessionEvent[] = [];

    switch (chunk.type) {
      case 'start': {
        messageId = chunk.messageId ?? '';
        agentStarted = true;
        out.push({ type: 'agent_start' });
        break;
      }
      case 'start-step': {
        turnOpen = true;
        out.push({ type: 'turn_start' });
        openMessage(out);
        break;
      }

      case 'text-start': {
        if (!message) break;
        const index = contentIndex++;
        textBlocks.set(chunk.id, { index, text: '' });
        message.content.push({ type: 'text', text: '' });
        out.push({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_start', contentIndex: index },
        });
        break;
      }
      case 'text-delta': {
        const block = textBlocks.get(chunk.id);
        if (!block || !message) break;
        block.text += chunk.delta;
        (message.content[block.index] as { text: string }).text = block.text;
        out.push({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: block.index,
            delta: chunk.delta,
          },
        });
        break;
      }
      case 'text-end': {
        const block = textBlocks.get(chunk.id);
        if (!block) break;
        out.push({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: block.index,
            content: block.text,
          },
        });
        break;
      }

      case 'reasoning-start': {
        if (!message) break;
        const index = contentIndex++;
        textBlocks.set(chunk.id, { index, text: '' });
        message.content.push({ type: 'thinking', thinking: '' });
        out.push({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_start', contentIndex: index },
        });
        break;
      }
      case 'reasoning-delta': {
        const block = textBlocks.get(chunk.id);
        if (!block || !message) break;
        block.text += chunk.delta;
        (message.content[block.index] as { thinking: string }).thinking = block.text;
        out.push({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'thinking_delta',
            contentIndex: block.index,
            delta: chunk.delta,
          },
        });
        break;
      }
      case 'reasoning-end': {
        const block = textBlocks.get(chunk.id);
        if (!block) break;
        out.push({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'thinking_end',
            contentIndex: block.index,
            content: block.text,
          },
        });
        break;
      }

      case 'tool-input-start': {
        if (!message) break;
        const index = contentIndex++;
        toolCalls.set(chunk.toolCallId, { index, name: chunk.toolName, args: {} });
        message.content.push({
          type: 'toolCall',
          id: chunk.toolCallId,
          name: chunk.toolName,
          arguments: {},
        });
        out.push({
          type: 'message_update',
          assistantMessageEvent: { type: 'toolcall_start', contentIndex: index },
        });
        break;
      }
      case 'tool-input-delta': {
        const call = toolCalls.get(chunk.toolCallId);
        if (!call) break;
        out.push({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: call.index,
            delta: chunk.inputTextDelta,
          },
        });
        break;
      }
      case 'tool-input-available':
      case 'tool-input-error': {
        // input-available may arrive without a preceding input-start (non-streamed
        // providers); allocate the block on the fly so the pair stays balanced.
        let call = toolCalls.get(chunk.toolCallId);
        if (!call) {
          if (!message) break;
          call = { index: contentIndex++, name: chunk.toolName, args: {} };
          toolCalls.set(chunk.toolCallId, call);
          message?.content.push({
            type: 'toolCall',
            id: chunk.toolCallId,
            name: chunk.toolName,
            arguments: {},
          });
          out.push({
            type: 'message_update',
            assistantMessageEvent: { type: 'toolcall_start', contentIndex: call.index },
          });
        }
        call.args = asArgs(chunk.input);
        const toolCall: ToolCall = {
          type: 'toolCall',
          id: chunk.toolCallId,
          name: chunk.toolName,
          arguments: call.args,
        };
        if (message) message.content[call.index] = toolCall;
        out.push({
          type: 'message_update',
          assistantMessageEvent: { type: 'toolcall_end', contentIndex: call.index, toolCall },
        });
        // A malformed input never executes — surface it as a failed execution
        // so the call still gets its closing bracket.
        if (chunk.type === 'tool-input-error') {
          endExecution(
            out,
            chunk.toolCallId,
            { content: [], details: { errorText: chunk.errorText } },
            true,
          );
        }
        break;
      }

      case 'tool-output-available': {
        const result: ToolExecutionResult = { content: [], details: chunk.output };
        if (chunk.preliminary) {
          ensureExecuting(out, chunk.toolCallId);
          const toolName = executing.get(chunk.toolCallId)?.name ?? 'unknown';
          const args = executing.get(chunk.toolCallId)?.args ?? {};
          out.push({
            type: 'tool_execution_update',
            toolCallId: chunk.toolCallId,
            toolName,
            args,
            partialResult: result,
          });
        } else {
          endExecution(out, chunk.toolCallId, result, false);
        }
        break;
      }
      case 'tool-output-error': {
        endExecution(
          out,
          chunk.toolCallId,
          { content: [], details: { errorText: chunk.errorText } },
          true,
        );
        break;
      }
      case 'tool-output-denied': {
        endExecution(out, chunk.toolCallId, { content: [], details: { denied: true } }, true);
        break;
      }
      case 'tool-approval-request': {
        out.push({
          type: 'approval_requested',
          approvalId: chunk.approvalId,
          toolCallId: chunk.toolCallId,
        });
        break;
      }

      case 'finish-step': {
        // A step that ran tools already closed its message; its turn ends here.
        // A text-only step is the run's last — hold the message open, the
        // stop reason only arrives on `finish`.
        if (!message) closeTurn(out);
        break;
      }
      case 'finish': {
        const md = (chunk.messageMetadata ?? {}) as MetadataTokens;
        if (message && chunk.messageMetadata) message.usage = usageFromMetadata(md);
        switch (chunk.finishReason) {
          case undefined:
          case 'stop':
            closeMessage(out, { kind: 'done', reason: 'stop' });
            break;
          case 'length':
            closeMessage(out, { kind: 'done', reason: 'length' });
            break;
          case 'tool-calls':
            closeMessage(out, { kind: 'done', reason: 'toolUse' });
            break;
          case 'other':
            if (message) message.rawStopReason = 'other';
            closeMessage(out, { kind: 'done', reason: 'stop' });
            break;
          case 'content-filter':
            if (message) message.rawStopReason = 'content-filter';
            closeMessage(out, {
              kind: 'error',
              reason: 'error',
              errorMessage: 'response blocked by provider content filter',
            });
            break;
          case 'error':
            closeMessage(out, { kind: 'error', reason: 'error' });
            break;
        }
        // Turn-total metadata (duration, tokens, model) always goes out as a
        // notice: when the message closed before `finish`, folding is impossible,
        // and the renderer attaches it either way.
        if (chunk.messageMetadata) {
          out.push({ type: 'notice', name: 'message-metadata', payload: chunk.messageMetadata });
        }
        closeTurn(out);
        closeAgent(out);
        break;
      }
      case 'message-metadata': {
        out.push({ type: 'notice', name: 'message-metadata', payload: chunk.messageMetadata });
        break;
      }

      case 'error': {
        closeMessage(out, { kind: 'error', reason: 'error', errorMessage: chunk.errorText });
        out.push({ type: 'notice', name: 'stream-error', payload: { errorText: chunk.errorText } });
        break;
      }
      case 'abort': {
        closeAll(out);
        break;
      }

      case 'file': {
        // No pi stream event carries assistant files; keep the part on the
        // message (unknown content types round-trip) and notify live renderers.
        message?.content.push({
          type: 'file',
          url: chunk.url,
          mediaType: chunk.mediaType,
        } as Content);
        out.push({
          type: 'notice',
          name: 'file',
          payload: { url: chunk.url, mediaType: chunk.mediaType },
        });
        break;
      }
      case 'source-url':
      case 'source-document': {
        out.push({ type: 'notice', name: 'source', payload: chunk });
        break;
      }

      default: {
        if (chunk.type.startsWith('data-')) {
          const { type, ...payload } = chunk as { type: string; [key: string]: unknown };
          out.push({ type: 'notice', name: type.slice('data-'.length), payload });
        }
        break;
      }
    }
    return out;
  }

  function finalize(): AgentSessionEvent[] {
    if (agentEnded) return [];
    const out: AgentSessionEvent[] = [];
    closeAll(out, 'stream ended before the run finished');
    return out;
  }

  return { push, finalize };
}
