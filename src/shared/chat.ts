import type { PermissionOptionKind } from '@agentclientprotocol/sdk';
import type { UIMessage } from 'ai';
import type { AtriumTools, ToolName } from './tools';

/** One tool call a subagent made, bubbled up live for its card's activity list
 *  (shown as a static "verb + target" line; no output/expansion). */
export type SubagentActivityTool = { id: string; name: ToolName; input: unknown };

/**
 * Transient UI data parts the server streams via writer.write — delivered to
 * the client's onData, never persisted into messages. `compaction` announces
 * an in-progress cross-turn fold (phase start/done) so the UI shows a live
 * indicator. Within-turn folds aren't surfaced (internal, not persisted).
 * `subagent` bubbles a delegated subagent's activity (keyed by the task tool's
 * call id) so its card can show a live nested trace; never persisted, so a
 * reloaded card shows just the result. `imageGeneration` flags a direct
 * image-model turn in progress (it streams only the image at the end, so the
 * message is empty until then) to drive a loading indicator. `permissionRequest`
 * surfaces an external (ACP) agent's blocked permission ask — the agent process
 * is parked mid-turn on it, so the answer goes back over a side endpoint rather
 * than a new chat turn; a reload mid-approval replays it (the stream is still
 * live), restoring the card. `permissionResolved` is its settlement receipt:
 * a reload replays the whole buffer, so without it every already-answered ask
 * would re-materialize as a ghost card — replaying request + receipt nets out.
 */
export type AtriumDataParts = {
  compaction: { phase: 'start' | 'done' };
  subagent:
    | { id: string; phase: 'start' }
    | { id: string; phase: 'step'; tools: SubagentActivityTool[] }
    | { id: string; phase: 'done'; status: 'done' | 'failed' };
  imageGeneration: { phase: 'start' | 'done' };
  permissionRequest: {
    requestId: string;
    toolCallId: string;
    title: string;
    /** The command / path / title to show in the card's mono block, verbatim. */
    target: string;
    /** Mono prefix: `$ ` for a shell command, `✎ ` for a file change. */
    prefix: string;
    /** Whether the agent offered an "allow always" option for this call. */
    canAlways: boolean;
  };
  permissionResolved: { requestId: string };
};

/**
 * The user's answer to an external agent's permission request, sent to the
 * acp-permission endpoint. Semantic (not an optionId) so the server maps it to
 * one of the agent-supplied options — a stale or forged optionId can't be
 * injected from the client. Derived from the protocol's option vocabulary minus
 * reject_always: the approval card deliberately offers no persistent deny (the
 * agent stores it on its side, where our Settings can't list or undo it).
 * Cancellation isn't a decision — stop/abort settles parked requests directly.
 */
export type AcpPermissionDecision = Exclude<PermissionOptionKind, 'reject_always'>;

/**
 * Per-assistant-message observability, minted server-side via the stream's
 * messageMetadata callback and persisted alongside parts. `durationMs` drives
 * the "Worked for …" trace header; it's only present once a turn finishes.
 */
export type AtriumMessageMetadata = {
  createdAt?: number;
  durationMs?: number;
  totalTokens?: number;
  /** Prompt tokens at turn end (last step input+output) — compaction's counting base. */
  contextTokens?: number;
  /** Marks the persisted compaction checkpoint pair (summary + its ack). */
  kind?: 'compaction' | 'compaction-ack';
  /** On a 'compaction' summary, the id of the last folded message. */
  coveredThroughId?: string;
};

/**
 * Canonical chat message shape across Atrium (persisted in messages.parts,
 * streamed over /api/chat, rendered by the chat components). The tools generic
 * makes tool parts (name, input, output) strongly typed end to end.
 */
export type AtriumUIMessage = UIMessage<AtriumMessageMetadata, AtriumDataParts, AtriumTools>;
