import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult } from '@shared/chat-types';
import type { InteractionDecision, InteractionRequest } from '@shared/interactions';
import type { PermissionMode } from '@shared/permissions';
import { type ChatStatus, generateId } from '@shared/ui-message';
import { RunAssembler } from './reduce';
import type { ChatTransport, StreamHandlers } from './transport';

/**
 * The chat data plane over the pi event track: a send starts a run and the
 * run's event log is watched from its first event; reopening a thread rejoins
 * one still in flight. Messages are assembled by RunAssembler in the part shape
 * the components already consume.
 *
 * A run that asks the user something keeps streaming while it waits. The
 * decision goes out on its own, to that run; what follows — the tool running,
 * the reply continuing — arrives on the same stream, so nothing here marks a
 * call done on the user's say-so.
 *
 * Detaching from a log never stops the run behind it. Closing a tab, switching
 * threads and being evicted from the cache all detach; only `stop` ends a turn.
 */

export type PiChatSnapshot = {
  messages: AtriumUIMessage[];
  status: ChatStatus;
  error?: Error;
};

type SendExtras = {
  threadId: string;
  providerId?: string;
  modelId?: string;
  permissionMode?: PermissionMode;
};

export type PiChatInit = {
  threadId: string;
  messages: AtriumUIMessage[];
  transport: ChatTransport;
  getExtras: () => SendExtras;
  /** Side-effect notices (title, compaction, subagent…) routed outside the message. */
  onNotice: (name: string, payload: unknown) => void;
};

type Part = AtriumUIMessage['parts'][number];

const NOTIFY_THROTTLE_MS = 50;

const EXPIRED_TEXT = 'The run ended before this was decided.';

/** States a card is in only while a run is there to answer it. */
const WAITING_STATES = new Set(['approval-requested', 'input-available', 'input-streaming']);

/**
 * Nothing is waiting on a run that is no longer there. The cards it left behind
 * become terminal so they can't be submitted to a run that ended; what it did
 * finish is untouched, and the stored conversation is repaired by the next run.
 */
function expireInactiveInteractions(messages: AtriumUIMessage[]): AtriumUIMessage[] {
  return messages.map((message) => {
    if (!message.parts.some((part) => WAITING_STATES.has((part as { state?: string }).state ?? '')))
      return message;
    return {
      ...message,
      parts: message.parts.map((part) =>
        WAITING_STATES.has((part as { state?: string }).state ?? '')
          ? ({ ...part, state: 'output-error', errorText: EXPIRED_TEXT } as Part)
          : part,
      ),
    };
  });
}

export class PiChat {
  readonly threadId: string;
  private history: AtriumUIMessage[];
  private run: RunAssembler | null = null;
  private status: ChatStatus = 'ready';
  private failure: Error | undefined;
  private listeners = new Set<() => void>();
  private snap: PiChatSnapshot;
  private dirty = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private lastSeq = -1;
  /** The attached stream's reading, so a stop can wait for the run's last events. */
  private streaming: Promise<void> | null = null;
  /** Requests with a decision on its way, so a second click can't send another. */
  private submitting = new Set<string>();

  constructor(private readonly init: PiChatInit) {
    this.threadId = init.threadId;
    this.history = init.messages;
    this.snap = { messages: [...this.history], status: 'ready' };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PiChatSnapshot => {
    if (this.dirty) {
      this.snap = { messages: this.merged(), status: this.status, error: this.failure };
      this.dirty = false;
    }
    return this.snap;
  };

  get isBusy(): boolean {
    return this.status === 'submitted' || this.status === 'streaming';
  }

  sendMessage = (input: { text: string; files?: Part[] }): void => {
    if (this.isBusy) return;
    const message: AtriumUIMessage = {
      id: generateId(),
      role: 'user',
      parts: [...(input.files ?? []), { type: 'text', text: input.text }],
      metadata: { createdAt: Date.now() },
    };
    this.history = [...this.history, message];
    this.streaming = this.startRun(message);
  };

  /** Rejoin a run still in flight. Delivering nothing means there was none. */
  resume = (): void => {
    if (this.isBusy) return;
    const abort = this.begin('streaming');
    this.streaming = (async () => {
      try {
        const finished = await this.watch(
          (handlers) => this.init.transport.rejoin({ threadId: this.threadId, from: -1 }, handlers),
          abort,
        );
        if (abort.signal.aborted) return;
        if (this.lastSeq === -1) {
          this.history = expireInactiveInteractions(this.history);
          this.settle();
          return;
        }
        this.finalizeRun(finished);
      } catch (err) {
        if (!abort.signal.aborted) this.failWith(err);
      }
    })();
  };

  /**
   * Stop the run on the server, then let its stream deliver the final events.
   * Closing the stream alone would leave the run going, so a request that fails
   * leaves it running and rejects for the caller to show.
   */
  stop = async (): Promise<void> => {
    if (!this.isBusy) return;
    await this.init.transport.abort(this.threadId);
    await this.streaming;
  };

  setMessages = (
    next: AtriumUIMessage[] | ((prev: AtriumUIMessage[]) => AtriumUIMessage[]),
  ): void => {
    this.history = typeof next === 'function' ? next(this.merged()) : next;
    this.run = null;
    this.notify(true);
  };

  /** Answer, or dismiss, the question the run is waiting on. */
  addToolOutput = async (input: {
    tool?: string;
    toolCallId: string;
    output: unknown;
  }): Promise<void> => {
    const result = input.output as ClarifyResult;
    const decision: InteractionDecision = result.cancelled
      ? { kind: 'cancelled' }
      : { kind: 'answered', answers: result.answers.map((item) => item.answer) };
    await this.submitDecision(this.run?.openInteractionForTool(input.toolCallId), decision);
  };

  addToolApprovalResponse = async (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }): Promise<void> => {
    const decision: InteractionDecision = input.approved
      ? { kind: 'approved' }
      : { kind: 'denied', ...(input.reason && { reason: input.reason }) };
    await this.submitDecision(this.run?.openInteraction(input.id), decision);
  };

  private async submitDecision(
    request: InteractionRequest | undefined,
    decision: InteractionDecision,
  ): Promise<void> {
    // Only the stream the run is still writing can be waiting; a card from history can't.
    if (!request) throw new Error('The interaction is no longer active.');
    if (this.submitting.has(request.id)) return;
    this.submitting.add(request.id);
    try {
      await this.init.transport.decide({
        threadId: this.threadId,
        interaction: { runId: request.runId, interactionId: request.id, decision },
      });
    } finally {
      this.submitting.delete(request.id);
    }
  }

  /**
   * Start a turn, then watch its log from the first event.
   *
   * The log exists by the time `send` resolves, and outlives its run, so a turn
   * that finishes before the watch attaches is still replayed in full — which
   * is why starting and watching can be two calls rather than one response.
   */
  private async startRun(message: AtriumUIMessage): Promise<void> {
    const abort = this.begin('submitted');
    try {
      await this.init.transport.send({ ...this.init.getExtras(), message });
      if (abort.signal.aborted) return;
      const finished = await this.watch(
        (handlers) => this.init.transport.events({ threadId: this.threadId, from: -1 }, handlers),
        abort,
      );
      if (abort.signal.aborted) return;
      this.finalizeRun(finished);
    } catch (err) {
      if (!abort.signal.aborted) this.failWith(err);
    }
  }

  /**
   * Fold a log's envelopes into the run being assembled, until it ends.
   *
   * Resolves with whether the run said it finished. A log that ends without
   * saying so is a run that went away mid-turn, which the caller treats as a
   * lost run rather than a completed one. Detaching on abort is what keeps a
   * superseded watch from writing into the next one's assembler; the run it was
   * reading carries on regardless.
   */
  private watch(
    open: (handlers: StreamHandlers) => () => void,
    abort: AbortController,
  ): Promise<boolean> {
    let assembling = false;
    let finished = false;
    return new Promise<boolean>((resolve, reject) => {
      let detach = (): void => {};
      const settle = (done: () => void) => {
        detach();
        done();
      };
      detach = open({
        onData: (envelope) => {
          if (envelope.seq <= this.lastSeq) return;
          this.lastSeq = envelope.seq;
          if (!assembling) {
            assembling = true;
            this.run = new RunAssembler();
          }
          if (this.status !== 'streaming') this.status = 'streaming';
          this.run?.apply(envelope.event);
          if (envelope.event.type === 'run_finished') finished = true;
          if (envelope.event.type === 'notice') {
            this.init.onNotice(envelope.event.name, envelope.event.payload);
          }
          this.notify();
        },
        onError: (error) => settle(() => reject(error)),
        onComplete: () => settle(() => resolve(finished)),
      });
      abort.signal.addEventListener('abort', () => settle(() => resolve(finished)), { once: true });
    });
  }

  private begin(status: ChatStatus): AbortController {
    this.inflight?.abort();
    const abort = new AbortController();
    this.inflight = abort;
    this.lastSeq = -1;
    this.failure = undefined;
    this.status = status;
    this.notify(true);
    return abort;
  }

  /**
   * Fold the finished (or detached) run into history, keyed by message id. A
   * stream that could not be rejoined is a lost connection, not a finished run:
   * what arrived is kept, but nothing is reading that run any more, so the
   * cards it was waiting on are expired rather than left looking answerable.
   * A later resume that reaches a live run replays them as live again.
   */
  private finalizeRun(finished = true): void {
    const live = this.run?.snapshot();
    this.run = null;
    this.inflight = null;
    if (live?.message) this.history = upsertById(this.history, live.message);
    if (live?.error) this.failure = new Error(live.error);
    else if (!finished) {
      this.history = expireInactiveInteractions(this.history);
      this.failure = new Error('The connection to the run was interrupted.');
    }
    this.settle();
  }

  private settle(): void {
    this.status = this.failure ? 'error' : 'ready';
    this.notify(true);
  }

  private failWith(err: unknown): void {
    this.run = null;
    this.inflight = null;
    this.failure = err instanceof Error ? err : new Error(String(err));
    this.settle();
  }

  private merged(): AtriumUIMessage[] {
    const live = this.run?.snapshot().message;
    if (!live) return [...this.history];
    return [...this.history.filter((m) => m.id !== live.id), live];
  }

  private notify(immediate = false): void {
    this.dirty = true;
    if (immediate) {
      if (this.notifyTimer) {
        clearTimeout(this.notifyTimer);
        this.notifyTimer = null;
      }
      this.emit();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.emit();
    }, NOTIFY_THROTTLE_MS);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function upsertById(list: AtriumUIMessage[], message: AtriumUIMessage): AtriumUIMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index === -1) return [...list, message];
  const next = [...list];
  next[index] = message;
  return next;
}
