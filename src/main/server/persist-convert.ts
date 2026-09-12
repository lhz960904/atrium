import type { AtriumUIMessage } from '@shared/chat';
import { isMcpToolName } from '@shared/mcp';
import type {
  AssistantMessage,
  Content,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@shared/protocol';

/**
 * Between the run-shaped message the renderer consumes and the per-message
 * shape everything else speaks: the user's turn, one assistant message per
 * step, and each tool result on its own.
 *
 * Splitting is now only the user's own turn, which arrives in the composer's
 * part shape. Merging is what the session projection folds a run back together
 * with, which is why it still lives here: there is one implementation of that
 * fold and this is it.
 *
 * UI-only tool state pi has no slot for — a pending or answered approval, a
 * call still streaming its input — is carried alongside under `toolStates`, so
 * the message JSON itself stays a clean subset of pi's vocabulary.
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
