import { randomUUID } from 'node:crypto';
import type {
  AgentMessage,
  Entry,
  LaneRecord,
  OperationStartedRecord,
  Session,
} from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type {
  SqliteSessionMetadata,
  SqliteSessionRepository,
} from '@earendil-works/pi-session-backend-sqlite-node';
import type { Fold } from '@main/agent/context/compaction';
import type { AtriumUIMessage } from '@shared/chat';
import type { InteractionOutcome, InteractionRequest, RunStopReason } from '@shared/interactions';
import {
  getAgentMessages,
  getUIMessages,
  INTERACTION_ENTRY,
  type InteractionEntryData,
} from '../project';
import { recoverInterruptedRun } from '../recovery';
import { threadStore } from './threads';

/** A run's stop reason, kept so a later boot can still name it. */
export const RUN_STOP_ENTRY = 'atrium.run_stop';

export type RunStopEntryData = { runId: string; reason: RunStopReason };

/**
 * A model call Atrium makes beside the conversation. Each spends real tokens
 * and none of them produces an entry, so the ledger would miss them entirely.
 */
export type SideCallKind = 'title' | 'summary' | 'review' | 'subagent';

/**
 * The one place that knows how a conversation is stored.
 *
 * Every caller above this line speaks in intents — the run started, this turn
 * landed, the user was asked something — and never in entries, records, lanes
 * or durability. That is what keeps the store's shape free to change: pi's
 * session API is the part of our dependency most likely to move under us, and
 * a rewrite should be an edit to this file rather than a search across four.
 */

/**
 * A conversation runs on one lane. Branching is pi's to offer and ours to
 * ignore: a thread is a single line the user can rewind, never two at once.
 */
const LANE = 'main';

/**
 * What the store will accept: no `undefined`, no class instances, no non-finite
 * numbers. Our messages routinely carry all three — a tool's `details` is
 * whatever that tool returned — and one rejected append fails the whole turn.
 * Serializing and parsing back is exactly the normalization that check asks
 * for, so every write goes through it rather than trusting its caller.
 */
function durable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A single thread's conversation, and every way this app writes to one. */
export class Conversation {
  constructor(private readonly session: Session<SqliteSessionMetadata>) {}

  metadata(): Promise<SqliteSessionMetadata> {
    return this.session.getMetadata();
  }

  entries(): Promise<Entry[]> {
    return this.session.findEntriesOnBranch({ order: 'oldestFirst' });
  }

  records(): Promise<LaneRecord[]> {
    return this.session.findRecords({ order: 'oldestFirst' });
  }

  entry(id: string): Promise<Entry | undefined> {
    return this.session.getEntry(id);
  }

  /** Runs whose bracket was never closed, newest lane state first. */
  openRuns(): Promise<OperationStartedRecord[]> {
    return this.session.findOpenOperations(LANE);
  }

  /** When a run opened, as the store recorded it. */
  async runStartedAt(runId: string): Promise<number | undefined> {
    const [started] = await this.session.findRecords({
      type: 'operation_started',
      runId,
      limit: 1,
    });
    return started?.timestamp;
  }

  /**
   * Open a run's bracket. It is what makes the run addressable when the session
   * is read back, and an unfinished one is how a later boot knows the run never
   * got to end. A lane holds one at a time, so this throws while another is
   * open — the caller closes it first.
   */
  async startRun(runId: string): Promise<void> {
    await this.session.appendRecord({
      id: runId,
      lane: LANE,
      type: 'operation_started',
      sourceLeafId: await this.session.getLeafId(),
      intent: { kind: 'run', originalPrompt: [], initialMessages: [] },
    });
  }

  /**
   * Close a run's bracket, which is also what releases the lane. Answers
   * whether this call was the one that closed it.
   *
   * Asking first is what lets a repair run twice: a run is closed by the
   * process that opened it or, when that process died, by a later one, and
   * neither knows what the other got to do. The id is derived from the run so
   * that a second close is refused rather than quietly recorded twice — pi
   * checks ids across entries *and* records, and a duplicate throws.
   */
  async finishRun(runId: string, outcome: 'completed' | 'aborted' | 'failed'): Promise<boolean> {
    const [finished] = await this.session.findRecords({
      type: 'operation_finished',
      runId,
      limit: 1,
    });
    if (finished) return false;
    await this.session.appendRecord({
      id: `${runId}:finished`,
      lane: LANE,
      type: 'operation_finished',
      runId,
      outcome,
    });
    return true;
  }

  /**
   * The turn that opened a run, stored under the id its author already gave it:
   * the live view addresses the message by it, and editing that message later
   * has to find the entry it became.
   */
  async appendPrompt(id: string, message: AgentMessage): Promise<void> {
    await this.session.appendEntry({ id, type: 'message', message: durable(message) }, LANE);
  }

  /** A finished turn. Returns the entry id its usage record is keyed to. */
  appendTurn(message: AgentMessage): Promise<string> {
    return this.session.appendMessage(durable(message));
  }

  appendToolResult(message: AgentMessage): Promise<string> {
    return this.session.appendMessage(durable(message));
  }

  /**
   * A tool result standing in for one that never arrived. The stable id makes a
   * half-finished repair resumable: the store rejects a duplicate outright, so
   * the check is what makes a second pass safe.
   */
  async appendInterruptedResult(
    runId: string,
    toolCallId: string,
    message: AgentMessage,
  ): Promise<boolean> {
    const id = `${runId}:interrupted:${toolCallId}`;
    if (await this.session.getEntry(id)) return false;
    await this.session.appendEntry({ id, type: 'message', message: durable(message) }, LANE);
    return true;
  }

  async recordUsage(entry: {
    runId: string;
    entryId: string;
    attempt: number;
    stopReason: AssistantMessage['stopReason'];
    usage: AssistantMessage['usage'];
  }): Promise<void> {
    await this.session.appendRecord({
      id: randomUUID(),
      lane: LANE,
      type: 'usage',
      cause: 'assistant',
      runId: entry.runId,
      entryId: entry.entryId,
      attempt: entry.attempt,
      // A turn still streaming has no stop reason the record's enum admits.
      stopReason: entry.stopReason === 'pending' ? 'stop' : entry.stopReason,
      usage: durable(entry.usage),
    });
  }

  /**
   * Record what a call made beside the conversation spent.
   *
   * `adjustment` is the one cause whose `runId` is optional, which is why all
   * of these use it: a title can land after its run has closed, and by pi's own
   * rules (`validateRecordLog`) a record that *declares* a runId outside its
   * operation's lifetime makes the log corrupt. Nothing we call runs that check
   * today — which is exactly why the log has to be kept valid deliberately. The
   * run rides in `details` instead, where it is data rather than a claim.
   */
  async recordSideUsage(call: {
    kind: SideCallKind;
    usage: AssistantMessage['usage'];
    providerId?: string;
    modelId?: string;
    runId?: string;
  }): Promise<void> {
    await this.session.appendRecord({
      id: randomUUID(),
      lane: LANE,
      type: 'usage',
      cause: 'adjustment',
      usage: durable(call.usage),
      details: durable({
        kind: call.kind,
        ...(call.providerId ? { providerId: call.providerId } : {}),
        ...(call.modelId ? { modelId: call.modelId } : {}),
        ...(call.runId ? { runId: call.runId } : {}),
      }),
    });
  }

  /** pi has no state for "waiting on the user", so it rides in entries of ours. */
  async recordInteractionRequested(request: InteractionRequest): Promise<void> {
    await this.appendInteraction(`${request.id}:requested`, { phase: 'requested', request });
  }

  async recordInteractionResolved(
    request: InteractionRequest,
    outcome: InteractionOutcome,
  ): Promise<void> {
    await this.appendInteraction(`${request.id}:resolved`, {
      phase: 'resolved',
      request,
      outcome,
    });
  }

  /** Settle a request the run ended without answering. */
  async settleInteraction(
    request: InteractionRequest,
    outcome: InteractionOutcome,
  ): Promise<boolean> {
    const id = `${request.id}:resolved`;
    if (await this.session.getEntry(id)) return false;
    await this.appendInteraction(id, { phase: 'resolved', request, outcome });
    return true;
  }

  /** Why a run stopped, kept so a later boot can still name it. */
  async recordRunStop(runId: string, reason: RunStopReason): Promise<void> {
    await this.session.appendEntry(
      {
        id: `${runId}:stopped`,
        type: 'custom',
        customType: RUN_STOP_ENTRY,
        data: durable({ runId, reason } satisfies RunStopEntryData),
      },
      LANE,
    );
  }

  /**
   * Record a fold. The folded messages stay in the session — only what the
   * model is shown gets shorter, and the reader rebuilds the shorter view from
   * this entry.
   */
  async appendCompaction(fold: Fold): Promise<void> {
    await this.session.appendEntry(
      {
        id: randomUUID(),
        type: 'compaction',
        summary: fold.summary,
        retainedTail: durable(fold.retainedTail),
        tokensBefore: fold.tokensBefore,
      },
      LANE,
    );
  }

  /**
   * Take the conversation back to just before one entry. Nothing is deleted:
   * the branch moves and the messages after it stay off to one side, which is
   * why a re-run can never half-truncate a thread.
   */
  async rewindTo(entryId: string): Promise<boolean> {
    const entry = await this.session.getEntry(entryId);
    if (!entry) return false;
    await this.session.moveLane(LANE, entry.parentId);
    return true;
  }

  private async appendInteraction(id: string, data: InteractionEntryData): Promise<void> {
    await this.session.appendEntry(
      { id, type: 'custom', customType: INTERACTION_ENTRY, data: durable(data) },
      LANE,
    );
  }
}

/**
 * The app's conversations, addressed by thread.
 *
 * A thread row owns what the product sorts, pins and archives by; a
 * conversation owns the messages. They are joined by id here and nowhere else,
 * which is what leaves either free to change shape.
 */
export class ConversationStore {
  /**
   * The repair each session has already had, by session id.
   *
   * The promise rather than a flag, so two opens racing for the same session
   * await one repair instead of both starting one. Once per process is also
   * what keeps a repair away from a live run: a run opens its own conversation
   * before it starts, so by the time it holds the lane this has already run.
   */
  private readonly repairs = new Map<string, Promise<void>>();

  constructor(private readonly repository: SqliteSessionRepository) {}

  /** A thread's conversation, or undefined while it has never run. */
  async forThread(threadId: string): Promise<Conversation | undefined> {
    const sessionId = threadStore().sessionId(threadId);
    if (!sessionId) return undefined;
    const metadata = await this.metadataOf(sessionId);
    // The row can outlive the session it names — a store rebuilt from scratch,
    // say. Treating that as "no conversation yet" keeps the thread openable.
    if (!metadata) return undefined;
    return this.repaired(sessionId, await this.repository.open(metadata));
  }

  /**
   * A thread's conversation, created on first use. Creating it with the first
   * turn rather than with the thread keeps a thread nobody wrote to free, and
   * means the workspace it records is the one the turn actually ran in.
   */
  async openForThread(threadId: string, workspaceRoot: string): Promise<Conversation> {
    const existing = await this.forThread(threadId);
    if (existing) return existing;

    const session = await this.repository.create({ cwd: workspaceRoot });
    const { id } = await session.getMetadata();
    threadStore().bindSession(threadId, id);
    // A session created here has nothing to repair, and saying so is what keeps
    // a later read from treating the run about to open as something to close.
    this.repairs.set(id, Promise.resolve());
    return new Conversation(session);
  }

  /**
   * A conversation with whatever the last process left half-written closed off.
   *
   * Repairing when the session is opened rather than when the next run starts
   * is what lets a thread nobody has written to since the crash still read
   * correctly: a call with no result would otherwise sit in the transcript
   * looking like it were still running.
   */
  private async repaired(
    sessionId: string,
    session: Session<SqliteSessionMetadata>,
  ): Promise<Conversation> {
    const conversation = new Conversation(session);
    let repair = this.repairs.get(sessionId);
    if (!repair) {
      repair = (async () => {
        for (const open of await conversation.openRuns()) {
          await recoverInterruptedRun(conversation, open.id, 'interrupted');
        }
      })();
      this.repairs.set(sessionId, repair);
    }
    await repair;
    return conversation;
  }

  /**
   * A thread's conversation in the shape the renderer consumes. A thread that
   * has never run has no session yet, which reads as an empty conversation.
   */
  async getUIMessagesByThreadID(threadId: string): Promise<AtriumUIMessage[]> {
    const conversation = await this.forThread(threadId);
    if (!conversation) return [];
    const [entries, records] = await Promise.all([conversation.entries(), conversation.records()]);
    return getUIMessages(entries, records);
  }

  /** A thread's transcript as the engine runs it, folded at its latest compaction. */
  async getAgentMessagesByThreadID(threadId: string): Promise<AgentMessage[]> {
    const conversation = await this.forThread(threadId);
    if (!conversation) return [];
    return getAgentMessages(await conversation.entries());
  }

  /** Drop a thread's conversation. The thread row is the caller's to remove. */
  async deleteForThread(threadId: string): Promise<void> {
    const sessionId = threadStore().sessionId(threadId);
    if (!sessionId) return;
    const metadata = await this.metadataOf(sessionId);
    if (metadata) await this.repository.delete(metadata);
  }

  private async metadataOf(sessionId: string): Promise<SqliteSessionMetadata | undefined> {
    const sessions = await this.repository.list();
    return sessions.find((session) => session.id === sessionId);
  }
}

let instance: ConversationStore | undefined;

/** Install the process's conversations, over the repository opened at boot. */
export function openConversationStore(repository: SqliteSessionRepository): void {
  instance = new ConversationStore(repository);
}

/** Forget them again, so a reopened database is never read through the old one. */
export function closeConversationStore(): void {
  instance = undefined;
}

/**
 * The app's conversations.
 *
 * One per process, held rather than rebuilt: anything the store learns — which
 * sessions it has already repaired, say — is only worth knowing if it outlives
 * the call that learned it.
 */
export function conversationStore(): ConversationStore {
  if (!instance) throw new Error('conversation store not initialized — call openDb() first');
  return instance;
}
