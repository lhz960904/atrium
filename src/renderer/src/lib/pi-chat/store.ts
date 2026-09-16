import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult } from '@shared/chat-types';
import type { InteractionDecision, InteractionRequest } from '@shared/interactions';
import type { PermissionMode } from '@shared/permissions';
import type { EventEnvelope } from '@shared/protocol';
import { type ChatStatus, generateId } from '@shared/ui-message';
import { RunAssembler } from './reduce';

/**
 * The chat data plane over the pi event track, replacing useChat + its
 * transport: a send POSTs /api/chat and the response is the run's pi event
 * SSE; reconnects replay the envelope log from seq 0. Messages are assembled
 * by RunAssembler in the part shape the components already consume.
 *
 * A run that asks the user something keeps streaming while it waits. The
 * decision goes out as its own short request to that run; what follows — the
 * tool running, the reply continuing — arrives on the same stream, so nothing
 * here marks a call done on the user's say-so.
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
  baseUrl: string;
  token: string;
  messages: AtriumUIMessage[];
  getExtras: () => SendExtras;
  /** Side-effect notices (title, compaction, subagent…) routed outside the message. */
  onNotice: (name: string, payload: unknown) => void;
  /** Injection point for tests. */
  fetchFn?: typeof fetch;
};

type Part = AtriumUIMessage['parts'][number];

const NOTIFY_THROTTLE_MS = 50;

const EXPIRED_TEXT = 'The run ended before this was decided.';

/** Rejoins attempted before a dropped stream is treated as a lost run. */
const RECONNECT_ATTEMPTS = 3;

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
  private readonly fetchFn: typeof fetch;

  constructor(private readonly init: PiChatInit) {
    this.threadId = init.threadId;
    this.history = init.messages;
    this.fetchFn = init.fetchFn ?? fetch.bind(globalThis);
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
    this.streaming = this.post({ path: '/api/chat', body: { message } });
  };

  /** Reconnect to a still-running stream; a 204 means nothing to rejoin. */
  resume = (): void => {
    if (this.isBusy) return;
    const abort = this.begin('streaming');
    this.streaming = (async () => {
      try {
        const res = await this.fetchFn(this.eventsUrl(), {
          headers: { 'x-atrium-token': this.init.token },
          signal: abort.signal,
        });
        if (res.status === 204 || !res.body) {
          this.history = expireInactiveInteractions(this.history);
          this.settle();
          return;
        }
        await this.attach(res.body, abort);
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
    const res = await this.fetchFn(`${this.init.baseUrl}/api/chat/${this.threadId}/abort`, {
      method: 'POST',
      headers: { 'x-atrium-token': this.init.token },
    });
    if (!res.ok) throw new Error(`Stopping the run failed (${res.status}).`);
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
      const res = await this.fetchFn(`${this.init.baseUrl}/api/chat/${this.threadId}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-atrium-token': this.init.token },
        body: JSON.stringify({ runId: request.runId, interactionId: request.id, decision }),
      });
      if (!res.ok) throw new Error(`The decision was not accepted (${res.status}).`);
    } finally {
      this.submitting.delete(request.id);
    }
  }

  private async post(input: { path: string; body: Record<string, unknown> }): Promise<void> {
    const abort = this.begin('submitted');
    try {
      const res = await this.fetchFn(`${this.init.baseUrl}${input.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-atrium-token': this.init.token },
        body: JSON.stringify({ ...this.init.getExtras(), ...input.body }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`chat request failed (${res.status}) ${await res.text().catch(() => '')}`);
      }
      await this.attach(res.body, abort);
    } catch (err) {
      if (!abort.signal.aborted) this.failWith(err);
    }
  }

  private eventsUrl(): string {
    return `${this.init.baseUrl}/api/chat/${this.threadId}/pi-events?from=-1`;
  }

  /**
   * Read a run's stream to its end, rejoining when it drops early: the
   * connection can die — a sleep long enough to lose the socket, a network
   * blip — while the run itself is still going on the other side. The server
   * replays from the start of the log, so each rejoin resets the seq floor and
   * rebuilds the message rather than continuing from a half-read one.
   */
  private async attach(body: ReadableStream<Uint8Array>, abort: AbortController): Promise<void> {
    let finished = await this.consume(body);
    for (let attempt = 0; !finished && attempt < RECONNECT_ATTEMPTS; attempt++) {
      if (abort.signal.aborted) return;
      const res = await this.fetchFn(this.eventsUrl(), {
        headers: { 'x-atrium-token': this.init.token },
        signal: abort.signal,
      });
      if (res.status === 204 || !res.body) break;
      this.lastSeq = -1;
      finished = await this.consume(res.body);
    }
    if (abort.signal.aborted) return;
    this.finalizeRun(finished);
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
   * Reads the run's stream; false when it ended before the run said it had.
   * The assembler is replaced by the first envelope that actually arrives, so a
   * rejoin that delivers nothing keeps what the dropped stream had built.
   */
  private async consume(body: ReadableStream<Uint8Array>): Promise<boolean> {
    let assembling = false;
    let finished = false;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
        if (!frame.startsWith('data: ')) continue;
        const envelope = JSON.parse(frame.slice('data: '.length)) as EventEnvelope;
        if (envelope.seq <= this.lastSeq) continue;
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
      }
    }
    return finished;
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
