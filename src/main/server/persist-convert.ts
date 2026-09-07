import type { AtriumUIMessage } from '@shared/chat';
import { isMcpToolName } from '@shared/mcp';
import type {
  AssistantMessage,
  Content,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '@shared/protocol';

/**
 * Converters between the run-shaped UIMessage the engine and renderer still
 * speak and the pi-native rows the DB stores: one row per pi message — the
 * user message, one assistant message per step, and each tool result its own
 * row — grouped by the run id. Splitting happens on write, merging on read;
 * both directions are mechanical and round-trip exactly over the part
 * inventory real threads contain.
 *
 * UI-only tool state pi has no slot for (pending/answered approvals, a call
 * still streaming its input) lives in the row's metadata under `toolStates`,
 * next to the run metadata on the first row — the pi message JSON stays a
 * clean subset-plus-nothing of pi's vocabulary.
 *
 * Known, deliberate losses on the write side (documented, not accidental):
 * reasoning providerMetadata is reduced to the anthropic signature
 * (thinkingSignature), and tool-part provider bookkeeping
 * (callProviderMetadata, toolMetadata, providerExecuted) is dropped.
 */

export type PiRow = {
  id: string;
  runId: string;
  role: 'user' | 'assistant' | 'toolResult';
  message: UserMessage | AssistantMessage | ToolResultMessage;
  metadata: Record<string, unknown> | null;
};

type Part = AtriumUIMessage['parts'][number];
type LoosePart = Record<string, unknown>;

/** UI tool state that has no pi slot, keyed by toolCallId in row metadata. */
type ToolStateExtras = Record<string, { state: string; approval?: unknown }>;

const isToolPart = (part: LoosePart): boolean =>
  typeof part.type === 'string' &&
  (part.type.startsWith('tool-') || part.type === 'dynamic-tool') &&
  typeof part.toolCallId === 'string';

const toolNameOf = (part: LoosePart): string =>
  part.type === 'dynamic-tool' ? String(part.toolName) : String(part.type).slice('tool-'.length);

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

// ---------------------------------------------------------------------------
// user messages
// ---------------------------------------------------------------------------

export function splitUserMessage(msg: AtriumUIMessage): PiRow {
  const createdAt = (msg.metadata?.createdAt as number | undefined) ?? 0;
  const content = (msg.parts as LoosePart[]).map((part): TextContent | Content => {
    if (part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
    // Attachments and composer extensions round-trip verbatim as unknown types.
    return part as Content;
  });
  return {
    id: msg.id,
    runId: msg.id,
    role: 'user',
    message: { role: 'user', content: content as UserMessage['content'], timestamp: createdAt },
    metadata: (msg.metadata as Record<string, unknown> | undefined) ?? null,
  };
}

export function mergeUserMessage(row: PiRow): AtriumUIMessage {
  const message = row.message as UserMessage;
  const content =
    typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content;
  return {
    id: row.id,
    role: 'user',
    parts: (content as LoosePart[]).map((part): Part => {
      if (part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
      return part as Part;
    }),
    metadata: (row.metadata ?? undefined) as AtriumUIMessage['metadata'],
  };
}

// ---------------------------------------------------------------------------
// assistant runs → per-turn assistant rows + toolResult rows
// ---------------------------------------------------------------------------

export function splitAssistantMessage(msg: AtriumUIMessage): PiRow[] {
  const metadata = (msg.metadata ?? {}) as Record<string, unknown>;
  const createdAt = (metadata.createdAt as number | undefined) ?? 0;

  // Cut the flat part list into turns at step-start markers.
  const turns: LoosePart[][] = [];
  let current: LoosePart[] = [];
  for (const part of msg.parts as LoosePart[]) {
    if (part.type === 'step-start') {
      if (current.length > 0) turns.push(current);
      current = [];
      continue;
    }
    current.push(part);
  }
  if (current.length > 0) turns.push(current);
  if (turns.length === 0) turns.push([]);

  // Row order is chronological: each turn's assistant row, then the tool
  // results its calls produced, then the next turn.
  const rows: PiRow[] = [];
  turns.forEach((turnParts, turnIndex) => {
    const content: Content[] = [];
    const resultRows: PiRow[] = [];
    const toolStates: ToolStateExtras = {};
    let hadToolCall = false;

    for (const part of turnParts) {
      if (part.type === 'text') {
        content.push({ type: 'text', text: String(part.text ?? '') });
      } else if (part.type === 'reasoning') {
        const signature = (part.providerMetadata as { anthropic?: { signature?: string } })
          ?.anthropic?.signature;
        content.push({
          type: 'thinking',
          thinking: String(part.text ?? ''),
          ...(signature ? { thinkingSignature: signature } : {}),
        });
      } else if (isToolPart(part)) {
        hadToolCall = true;
        const toolCallId = String(part.toolCallId);
        const toolName = toolNameOf(part);
        content.push({
          type: 'toolCall',
          id: toolCallId,
          name: toolName,
          arguments: (part.input as Record<string, unknown>) ?? {},
        });
        const state = String(part.state ?? 'input-available');
        if (state === 'output-available' || state === 'output-error' || state === 'output-denied') {
          resultRows.push({
            id: toolCallId,
            runId: msg.id,
            role: 'toolResult',
            message: {
              role: 'toolResult',
              toolCallId,
              toolName,
              content: [],
              details:
                state === 'output-available'
                  ? part.output
                  : state === 'output-error'
                    ? { errorText: String(part.errorText ?? '') }
                    : { denied: true },
              isError: state !== 'output-available',
              timestamp: createdAt + turnIndex,
            },
            metadata: null,
          });
        }
        // States (and approvals) pi cannot express are carried alongside.
        if (state !== 'output-available' && state !== 'output-error') {
          toolStates[toolCallId] = {
            state,
            ...(part.approval !== undefined ? { approval: part.approval } : {}),
          };
        }
      } else {
        // file parts, data-* parts and anything newer pass through verbatim.
        content.push(part as Content);
      }
    }

    const isLast = turnIndex === turns.length - 1;
    const rowMetadata: Record<string, unknown> = {};
    if (turnIndex === 0 && Object.keys(metadata).length > 0) Object.assign(rowMetadata, metadata);
    if (Object.keys(toolStates).length > 0) rowMetadata.toolStates = toolStates;

    rows.push({
      id: `${msg.id}:${turnIndex}`,
      runId: msg.id,
      role: 'assistant',
      message: {
        role: 'assistant',
        content,
        api: 'ai-sdk',
        provider: String(metadata.providerId ?? 'unknown'),
        model: String(metadata.modelId ?? 'unknown'),
        usage: isLast ? usageFromRunMetadata(metadata) : zeroUsage(),
        stopReason: hadToolCall ? 'toolUse' : 'stop',
        timestamp: createdAt + turnIndex,
      },
      metadata: Object.keys(rowMetadata).length > 0 ? rowMetadata : null,
    });
    rows.push(...resultRows);
  });

  return rows;
}

function usageFromRunMetadata(metadata: Record<string, unknown>): Usage {
  const n = (key: string) => (metadata[key] as number | undefined) ?? 0;
  return {
    input: n('inputTokens'),
    output: n('outputTokens'),
    cacheRead: n('cacheReadTokens'),
    cacheWrite: n('cacheCreationTokens'),
    totalTokens: n('totalTokens'),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function mergeAssistantMessage(runId: string, rows: PiRow[]): AtriumUIMessage {
  const results = new Map<string, ToolResultMessage>();
  for (const row of rows) {
    if (row.role === 'toolResult')
      results.set((row.message as ToolResultMessage).toolCallId, row.message as ToolResultMessage);
  }
  const assistantRows = rows.filter((r) => r.role === 'assistant');

  const parts: Part[] = [];
  let metadata: Record<string, unknown> | undefined;
  for (const [index, row] of assistantRows.entries()) {
    const rowMeta = (row.metadata ?? {}) as Record<string, unknown>;
    const toolStates = (rowMeta.toolStates ?? {}) as ToolStateExtras;
    if (index === 0) {
      const { toolStates: _dropped, ...rest } = rowMeta;
      if (Object.keys(rest).length > 0) metadata = rest;
    }
    parts.push({ type: 'step-start' });
    for (const content of (row.message as AssistantMessage).content as LoosePart[]) {
      if (content.type === 'text') {
        parts.push({ type: 'text', text: String(content.text ?? '') });
      } else if (content.type === 'thinking') {
        parts.push({
          type: 'reasoning',
          text: String(content.thinking ?? ''),
          ...(content.thinkingSignature
            ? { providerMetadata: { anthropic: { signature: content.thinkingSignature } } }
            : {}),
        } as Part);
      } else if (content.type === 'toolCall') {
        const call = content as unknown as ToolCall;
        parts.push(mergeToolPart(call, results.get(call.id), toolStates[call.id]));
      } else {
        parts.push(content as Part);
      }
    }
  }

  return {
    id: runId,
    role: 'assistant',
    parts,
    metadata: metadata as AtriumUIMessage['metadata'],
  };
}

function mergeToolPart(
  call: ToolCall,
  result: ToolResultMessage | undefined,
  extra: { state: string; approval?: unknown } | undefined,
): Part {
  const base: LoosePart = isMcpToolName(call.name)
    ? { type: 'dynamic-tool', toolName: call.name, toolCallId: call.id }
    : { type: `tool-${call.name}`, toolCallId: call.id };
  base.input = call.arguments;

  if (result) {
    const details = result.details as LoosePart | undefined;
    if (!result.isError) {
      Object.assign(base, { state: 'output-available', output: result.details });
    } else if (details?.denied === true) {
      Object.assign(base, { state: 'output-denied' });
      if (extra?.approval !== undefined) base.approval = extra.approval;
    } else {
      Object.assign(base, {
        state: 'output-error',
        errorText: String(details?.errorText ?? 'Tool failed.'),
      });
    }
    return base as Part;
  }

  base.state = extra?.state ?? 'input-available';
  if (extra?.approval !== undefined) base.approval = extra.approval;
  return base as Part;
}
