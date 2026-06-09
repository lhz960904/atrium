import { generateId, JsonToSseTransformStream, type UIMessageChunk } from 'ai';
import {
  createInMemoryResumableStreamStore,
  createResumableStreamContext,
} from 'assistant-stream/resumable';

/**
 * Resumable chat streams, backed by assistant-stream's in-memory store. The
 * producer drains the agent's stream into the store independently of any
 * client, and every reader (the original POST response and later GET
 * reconnects) replays the buffer from the start then tails live — so a client
 * that navigates away or reloads mid-generation rejoins token-by-token.
 *
 * Bounds keep memory in check: at most `maxStreams` concurrent runs, capped
 * chunks per run, and idle streams evicted after the TTL. The TTL is refreshed
 * on every chunk, so an actively-streaming run is never collected; only a
 * finished or stalled one ages out.
 */
const store = createInMemoryResumableStreamStore({
  maxStreams: 64,
  maxEntriesPerStream: 100_000,
  defaultTtlMs: 30 * 60_000,
  gcIntervalMs: 60_000,
});

// One live stream per thread; a new turn mints a fresh id and supersedes it.
const activeStreamByThread = new Map<string, string>();
const threadByStream = new Map<string, string>();
// The run's abort handle, keyed by stream id — lets an explicit stop request
// abort the agent loop (the producer is decoupled from the request, so closing
// the client connection alone never reaches it).
const abortByStream = new Map<string, AbortController>();
// Server-authoritative "is this thread generating?" — survives renderer reloads
// (the sidebar reads it over tRPC), unlike per-tab client state.
const runningThreads = new Set<string>();

const context = createResumableStreamContext({
  store,
  onFinalize: (streamId) => {
    abortByStream.delete(streamId);
    const threadId = threadByStream.get(streamId);
    if (threadId === undefined) return;
    threadByStream.delete(streamId);
    // Keep "running" set if a newer turn has already superseded this stream.
    if (activeStreamByThread.get(threadId) === streamId) runningThreads.delete(threadId);
  },
});

export function getRunningThreadIds(): string[] {
  return [...runningThreads];
}

/**
 * Abort a thread's in-flight run, if any. Aborting the agent's signal ends
 * streamText, which finalizes the stream (persisting whatever was generated).
 * Returns whether a live run was found to abort.
 */
export function abortThreadRun(threadId: string): boolean {
  const streamId = activeStreamByThread.get(threadId);
  const controller = streamId ? abortByStream.get(streamId) : undefined;
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * Start a thread's live stream and return an SSE byte stream for the caller.
 * The agent's UIMessage chunks are encoded to the SSE bytes the store holds
 * and the client's `useChat` parses. The run's AbortController is held so a
 * stop request can abort it.
 */
export function startThreadStream(
  threadId: string,
  agentStream: ReadableStream<UIMessageChunk>,
  abort: AbortController,
): Promise<ReadableStream<Uint8Array>> {
  const streamId = generateId();
  activeStreamByThread.set(threadId, streamId);
  threadByStream.set(streamId, threadId);
  abortByStream.set(streamId, abort);
  runningThreads.add(threadId);
  return context.run(streamId, () =>
    agentStream.pipeThrough(new JsonToSseTransformStream()).pipeThrough(new TextEncoderStream()),
  );
}

/**
 * Reattach to a thread's *still-running* stream, or null — the caller then
 * falls back to the DB. A finished run's buffer lingers in the store (TTL), but
 * its message is already persisted in the DB the client seeds from, so
 * replaying it would duplicate the content. A turn paused at an approval counts
 * as finished here (it waits on the user's decision, not on the stream), so a
 * reload during a pending approval rebuilds from the DB instead of replaying.
 */
export function resumeThreadStream(threadId: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!runningThreads.has(threadId)) return Promise.resolve(null);
  const streamId = activeStreamByThread.get(threadId);
  if (!streamId) return Promise.resolve(null);
  return context.resume(streamId);
}
