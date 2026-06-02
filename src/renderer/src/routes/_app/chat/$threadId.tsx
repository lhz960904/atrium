import { type Chat, useChat } from '@ai-sdk/react';
import type { AtriumUIMessage } from '@shared/chat';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ChatThread } from '../../../components/chat/ChatThread';
import { getThreadChat } from '../../../lib/chat-store';
import { getActivePlan } from '../../../lib/plan';
import { trpc } from '../../../lib/trpc';
import { useChatModel } from '../../../lib/use-chat-model';
import { useCompactionStore } from '../../../state/compaction-store';
import type { SelectedModel } from '../../../state/model-store';
import { usePendingInput } from '../../../state/pending-input-store';

export const Route = createFileRoute('/_app/chat/$threadId')({
  component: ChatView,
});

function ChatView(): React.JSX.Element {
  const { threadId } = Route.useParams();
  const thread = trpc.threads.get.useQuery({ id: threadId });
  const endpoint = trpc.system.chatEndpoint.useQuery();
  const { selected } = useChatModel();

  if (thread.isLoading || endpoint.isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (!thread.data) {
    return <Centered>对话不存在</Centered>;
  }
  if (!endpoint.data) {
    return <Centered>聊天服务未就绪</Centered>;
  }

  const initialMessages: AtriumUIMessage[] = thread.data.messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts as AtriumUIMessage['parts'],
    metadata: (m.metadata ?? undefined) as AtriumUIMessage['metadata'],
  }));

  return (
    <ChatRunner
      key={threadId}
      threadId={threadId}
      title={thread.data.title ?? '未命名对话'}
      initialMessages={initialMessages}
      model={selected}
      endpoint={endpoint.data}
    />
  );
}

function ChatRunner({
  threadId,
  title,
  initialMessages,
  model,
  endpoint,
}: {
  threadId: string;
  title: string;
  initialMessages: AtriumUIMessage[];
  model: SelectedModel | null;
  endpoint: { baseUrl: string; token: string };
}): React.JSX.Element {
  // The Chat persists across thread switches (see chat-store). Resolve it once
  // per mount via a ref guard — not useMemo, whose factory StrictMode may
  // double-invoke and flip `isNew` to false. initialMessages only seeds a
  // brand-new Chat; an existing one keeps its in-memory state. ChatRunner is
  // keyed on threadId, so each thread gets its own fresh ref.
  const resolved = useRef<{ chat: Chat<AtriumUIMessage>; resume: boolean } | null>(null);
  if (resolved.current === null) {
    const { chat, isNew } = getThreadChat(threadId, {
      messages: initialMessages,
      baseUrl: endpoint.baseUrl,
      token: endpoint.token,
    });
    // Resume only reconnects to a PRE-EXISTING run (e.g. reload mid-stream). A
    // brand-new thread is about to auto-send its draft below; resuming there
    // would attach a second consumer to that same run and double its content.
    // Decide once at mount (stable across re-renders) — a reused Chat never
    // resumes (it still holds its original stream).
    const willAutoSend = usePendingInput.getState().text !== null;
    resolved.current = { chat, resume: isNew && !willAutoSend };
  }
  const { chat, resume } = resolved.current;

  const { messages, sendMessage, status } = useChat<AtriumUIMessage>({ chat, resume });
  const compacting = useCompactionStore((s) => s.active[threadId] ?? false);

  const utils = trpc.useUtils();
  const markRead = trpc.threads.markRead.useMutation({
    onSuccess: () => utils.threads.list.invalidate(),
  });

  // Mark read on open (clears this thread's unread dot in the sidebar).
  // biome-ignore lint/correctness/useExhaustiveDependencies: markRead.mutate is stable; fire on thread change
  useEffect(() => {
    markRead.mutate({ id: threadId });
  }, [threadId]);

  // When a turn completes: refresh the persisted-message cache (so a later
  // rebuild seeds from current DB state), clear the running spinner promptly,
  // and mark read again — the active thread should never show its own unread dot.
  const wasStreaming = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: markRead.mutate is stable
  useEffect(() => {
    const streaming = status === 'submitted' || status === 'streaming';
    // Surface the sidebar spinner promptly instead of waiting for the next poll.
    if (streaming && !wasStreaming.current) utils.threads.running.invalidate();
    if (wasStreaming.current && !streaming) {
      utils.threads.get.invalidate({ id: threadId });
      utils.threads.running.invalidate();
      markRead.mutate({ id: threadId });
      // Safety net: clear the indicator if a 'done' event was missed (errored
      // or aborted mid-compaction) — the turn is over, so it can't be compacting.
      useCompactionStore.getState().setActive(threadId, false);
    }
    wasStreaming.current = streaming;
  }, [status, threadId, utils]);

  // Auto-send the home draft once the model is ready. Wait for `model` so a
  // not-yet-hydrated selection doesn't drop the draft; the ref guards against
  // re-sending when model changes.
  const sentRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sendMessage is stable; fire when model becomes ready
  useEffect(() => {
    if (sentRef.current || !model) return;
    const draft = usePendingInput.getState().consume();
    if (draft) sendMessage({ text: draft });
    sentRef.current = true;
  }, [model]);

  return (
    <ChatThread
      title={title}
      messages={messages}
      status={status}
      compacting={compacting}
      plan={getActivePlan(messages)}
      onSend={(text) => {
        if (!model) return;
        sendMessage({ text });
      }}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-6 text-fg-tertiary text-sm">
      {children}
    </div>
  );
}
