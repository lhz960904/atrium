import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult } from '@shared/chat-types';
import type { PermissionMode } from '@shared/permissions';
import type { EventEnvelope, ToolDecision } from '@shared/protocol';
import {
  type ChatStatus,
  generateId,
  getToolName,
  isStaticToolUIPart,
  isToolOrDynamicToolUIPart,
} from '@shared/ui-message';
import { RunAssembler } from './reduce';

/**
 * The chat data plane over the pi event track, replacing useChat + its
 * transport: a send POSTs /api/chat and the response is the run's pi event
 * SSE; reconnects replay the envelope log from seq 0. Messages are assembled
 * by RunAssembler in the part shape the components already consume.
 *
 * Continuations (a clarify answered, an approval decided) post the user's
 * decisions to the run that parked those calls and seed the assembler with the
 * message's parts, so the new run's events extend that message in place.
 * Auto-resume replicates useChat's sendAutomaticallyWhen contract.
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
type LoosePart = Record<string, unknown>;

const NOTIFY_THROTTLE_MS = 50;

/** A cancelled clarification resolves its tool call but must NOT auto-resume —
 *  the user took back the turn and sends again themselves. */
function lastClarifyCancelled(messages: AtriumUIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant') return false;
  return last.parts.some(
    (p) =>
      isStaticToolUIPart(p) &&
      getToolName(p) === 'ask_clarification' &&
      p.state === 'output-available' &&
      (p.output as ClarifyResult | undefined)?.cancelled === true,
  );
}

/** The last message's final-step tool parts — the ones a resume decision reads. */
function lastStepToolParts(messages: AtriumUIMessage[]) {
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant') return [];
  const stepStart = last.parts.findLastIndex((p) => p.type === 'step-start');
  return last.parts.slice(stepStart + 1).filter(isToolOrDynamicToolUIPart);
}

/** Every tool call of the last step has its result — the turn can continue. */
function toolRoundComplete(messages: AtriumUIMessage[]): boolean {
  const tools = lastStepToolParts(messages);
  return tools.length > 0 && tools.every((p) => p.state === 'output-available');
}

/** The user's answers for the last step's parked calls, as the wire states them. */
function decisionsOf(messages: AtriumUIMessage[]): ToolDecision[] {
  const out: ToolDecision[] = [];
  for (const part of lastStepToolParts(messages)) {
    const toolCallId = part.toolCallId;
    if (part.state === 'approval-responded') {
      out.push(
        part.approval?.approved
          ? { toolCallId, kind: 'approved' }
          : { toolCallId, kind: 'denied', reason: part.approval?.reason },
      );
    } else if (part.state === 'output-available') {
      out.push({ toolCallId, kind: 'answered', output: part.output });
    }
  }
  return out;
}

/** Every pending approval got its answer — the turn can continue and execute. */
function approvalsAnswered(messages: AtriumUIMessage[]): boolean {
  const tools = lastStepToolParts(messages);
  return (
    tools.some((p) => p.state === 'approval-responded') &&
    tools.every((p) => p.state !== 'approval-requested')
  );
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
    void this.post({ path: '/api/chat', body: { message } });
  };

  /** Reconnect to a still-running stream; a 204 means nothing to rejoin. */
  resume = (): void => {
    if (this.isBusy) return;
    const abort = this.begin('streaming');
    void (async () => {
      try {
        const res = await this.fetchFn(
          `${this.init.baseUrl}/api/chat/${this.threadId}/pi-events?from=-1`,
          { headers: { 'x-atrium-token': this.init.token }, signal: abort.signal },
        );
        if (res.status === 204 || !res.body) {
          this.settle();
          return;
        }
        await this.consume(res.body);
        this.finalizeRun();
      } catch (err) {
        if (!abort.signal.aborted) this.failWith(err);
      }
    })();
  };

  stop = (): void => {
    // Keep whatever streamed; the route seals dangling tool parts and tells
    // main to abort the producer.
    this.inflight?.abort();
    this.inflight = null;
    this.finalizeRun();
  };

  setMessages = (
    next: AtriumUIMessage[] | ((prev: AtriumUIMessage[]) => AtriumUIMessage[]),
  ): void => {
    this.history = typeof next === 'function' ? next(this.merged()) : next;
    this.run = null;
    this.notify(true);
  };

  addToolOutput = (input: { tool?: string; toolCallId: string; output: unknown }): void => {
    this.patchToolPart(input.toolCallId, () => ({
      state: 'output-available',
      output: input.output,
    }));
    this.maybeAutoResume();
  };

  addToolApprovalResponse = (input: { id: string; approved: boolean; reason?: string }): void => {
    this.patchApprovalPart(input.id, {
      state: 'approval-responded',
      approval: { id: input.id, approved: input.approved, reason: input.reason },
    });
    this.maybeAutoResume();
  };

  /** useChat's sendAutomaticallyWhen contract: a completed tool round or an
   *  answered approval resumes the turn the decisions belong to. */
  private maybeAutoResume(): void {
    if (this.isBusy) return;
    const messages = this.merged();
    const last = messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    const complete = toolRoundComplete(messages) || approvalsAnswered(messages);
    if (!complete || lastClarifyCancelled(messages)) return;
    void this.post({
      path: `/api/chat/${this.threadId}/resume`,
      body: { runId: last.id, decisions: decisionsOf(messages) },
      // A continuation extends the assistant message in place: seed the
      // assembler with its parts so the streamed tail lands after them.
      seed: { id: last.id, parts: last.parts },
    });
  }

  private async post(input: {
    path: string;
    body: Record<string, unknown>;
    seed?: { id: string; parts: Part[] };
  }): Promise<void> {
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
      await this.consume(res.body, input.seed);
      this.finalizeRun();
    } catch (err) {
      if (!abort.signal.aborted) this.failWith(err);
    }
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

  private async consume(
    body: ReadableStream<Uint8Array>,
    seed?: { id: string; parts: Part[] },
  ): Promise<void> {
    this.run = new RunAssembler(seed);
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
        if (this.status !== 'streaming') this.status = 'streaming';
        this.run?.apply(envelope.event);
        if (envelope.event.type === 'notice') {
          this.init.onNotice(envelope.event.name, envelope.event.payload);
        }
        this.notify();
      }
    }
  }

  /** Fold the finished (or detached) run into history, keyed by message id. */
  private finalizeRun(): void {
    const live = this.run?.snapshot();
    this.run = null;
    this.inflight = null;
    if (live?.message) this.history = upsertById(this.history, live.message);
    if (live?.error) this.failure = new Error(live.error);
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

  private patchToolPart(toolCallId: string, patch: (part: LoosePart) => LoosePart): void {
    this.history = this.history.map((message) => {
      const index = message.parts.findIndex(
        (p) => isToolOrDynamicToolUIPart(p) && p.toolCallId === toolCallId,
      );
      if (index === -1) return message;
      const parts = [...message.parts];
      parts[index] = {
        ...(parts[index] as LoosePart),
        ...patch(parts[index] as LoosePart),
      } as Part;
      return { ...message, parts };
    });
    this.notify(true);
  }

  private patchApprovalPart(approvalId: string, fields: LoosePart): void {
    this.history = this.history.map((message) => {
      const index = message.parts.findIndex(
        (p) =>
          isToolOrDynamicToolUIPart(p) &&
          (p as LoosePart & { approval?: { id?: string } }).approval?.id === approvalId,
      );
      if (index === -1) return message;
      const parts = [...message.parts];
      parts[index] = { ...(parts[index] as LoosePart), ...fields } as Part;
      return { ...message, parts };
    });
    this.notify(true);
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
