import type { AtriumUIMessage } from '@shared/chat';
import type {
  AssistantMessage,
  Content,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@shared/protocol';
import { toolPartIdentity, toolResultFields } from '@shared/tool-part';
import type { ToolApproval } from '@shared/ui-message';

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
 * call still streaming its input — is passed alongside the run's messages, so
 * the message JSON itself stays a clean subset of pi's vocabulary.
 */

type Part = AtriumUIMessage['parts'][number];
type LoosePart = Record<string, unknown>;

/** UI tool state that has no pi slot, keyed by toolCallId in row metadata. */
export type ToolStateExtra =
  | { state: 'input-available' }
  | { state: 'approval-requested' | 'approval-responded' | 'output-denied'; approval: ToolApproval }
  | { state: 'output-error'; errorText: string };
export type ToolStateExtras = Record<string, ToolStateExtra>;

// ---------------------------------------------------------------------------
// user messages
// ---------------------------------------------------------------------------

export function splitUserMessage(msg: AtriumUIMessage): UserMessage {
  const createdAt = (msg.metadata?.createdAt as number | undefined) ?? 0;
  const content = (msg.parts as LoosePart[]).map((part): TextContent | Content => {
    if (part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
    // Attachments and composer extensions round-trip verbatim as unknown types.
    return part as Content;
  });
  return { role: 'user', content: content as UserMessage['content'], timestamp: createdAt };
}

export function mergeUserMessage(
  id: string,
  message: UserMessage,
  metadata: Record<string, unknown>,
): AtriumUIMessage {
  const content =
    typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content;
  return {
    id,
    role: 'user',
    parts: (content as LoosePart[]).map((part): Part => {
      if (part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
      return part as Part;
    }),
    metadata: metadata as AtriumUIMessage['metadata'],
  };
}

// ---------------------------------------------------------------------------
// assistant runs → per-turn assistant rows + toolResult rows
// ---------------------------------------------------------------------------

/** One run, folded into the single assistant message the renderer draws. */
export function mergeAssistantMessage(
  runId: string,
  run: {
    /** The run's own turns and tool results, in the order they landed. */
    messages: (AssistantMessage | ToolResultMessage)[];
    /** Timing, model and cost — what the card shows about the run itself. */
    metadata: Record<string, unknown>;
    /** Tool state pi has no slot for, keyed by call id. */
    toolStates: ToolStateExtras;
  },
): AtriumUIMessage {
  const results = new Map<string, ToolResultMessage>();
  for (const message of run.messages) {
    if (message.role === 'toolResult') results.set(message.toolCallId, message);
  }
  const turns = run.messages.filter((m): m is AssistantMessage => m.role === 'assistant');
  const { toolStates } = run;

  const parts: Part[] = [];
  for (const turn of turns) {
    parts.push({ type: 'step-start' });
    for (const content of turn.content as LoosePart[]) {
      if (content.type === 'text') {
        parts.push({ type: 'text', text: String(content.text ?? '') });
      } else if (content.type === 'thinking') {
        parts.push({ type: 'reasoning', text: String(content.thinking ?? '') });
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
    metadata: (Object.keys(run.metadata).length > 0
      ? run.metadata
      : undefined) as AtriumUIMessage['metadata'],
  };
}

function mergeToolPart(
  call: ToolCall,
  result: ToolResultMessage | undefined,
  extra: ToolStateExtra | undefined,
): Part {
  const base: LoosePart = { ...toolPartIdentity(call.name, call.id), input: call.arguments };

  // A denial is the user's decision; the error result pi stands in for the
  // blocked call must not replace it.
  if (extra?.state === 'output-denied') {
    return { ...base, state: 'output-denied', approval: extra.approval } as Part;
  }
  if (result) {
    Object.assign(base, toolResultFields(result, Boolean(result.isError)));
    return base as Part;
  }

  if (extra?.state === 'output-error') {
    return { ...base, state: 'output-error', errorText: extra.errorText } as Part;
  }
  base.state = extra?.state ?? 'input-available';
  if (extra && 'approval' in extra) base.approval = extra.approval;
  return base as Part;
}
