import { useChat } from '@ai-sdk/react';
import type { AtriumUIMessage } from '@shared/chat';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { ChatThread } from '../../../components/chat/ChatThread';
import { makeChatTransport } from '../../../lib/chat-transport';
import { trpc } from '../../../lib/trpc';
import { usePendingInput } from '../../../state/pending-input-store';

export const Route = createFileRoute('/_app/chat/$threadId')({
  component: ChatView,
});

type SelectedModel = { providerId: string; modelId: string };

function ChatView(): React.JSX.Element {
  const { threadId } = Route.useParams();
  const thread = trpc.threads.get.useQuery({ id: threadId });
  const endpoint = trpc.system.chatEndpoint.useQuery();
  const providers = trpc.providers.list.useQuery();

  if (thread.isLoading || endpoint.isLoading || providers.isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (!thread.data) {
    return <Centered>对话不存在</Centered>;
  }

  const model = pickFirstEnabledModel(providers.data ?? []);
  const initialMessages: AtriumUIMessage[] = thread.data.messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts as AtriumUIMessage['parts'],
  }));

  return (
    <ChatRunner
      key={threadId}
      threadId={threadId}
      title={thread.data.title ?? '未命名对话'}
      initialMessages={initialMessages}
      model={model}
      endpoint={endpoint.data ?? null}
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
  endpoint: { baseUrl: string; token: string } | null;
}): React.JSX.Element {
  const transport = useMemo(() => {
    if (!endpoint) return undefined;
    return makeChatTransport(endpoint.baseUrl, endpoint.token, () => ({
      threadId,
      providerId: model?.providerId,
      modelId: model?.modelId,
    }));
  }, [endpoint, threadId, model]);

  const utils = trpc.useUtils();
  const { messages, sendMessage, status } = useChat<AtriumUIMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    // Refresh the persisted-message cache so navigating away and back
    // re-initializes useChat from the saved messages instead of stale empties.
    onFinish: () => {
      utils.threads.get.invalidate({ id: threadId });
      utils.threads.list.invalidate();
    },
  });

  // Auto-send the draft carried from the home composer once on mount.
  // consume() clears it, so StrictMode's double-invoke won't double-send.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const draft = usePendingInput.getState().consume();
    if (draft && model) sendMessage({ text: draft });
  }, []);

  return (
    <ChatThread
      title={title}
      messages={messages}
      status={status}
      onSend={(text) => {
        if (!model) return;
        sendMessage({ text });
      }}
    />
  );
}

function pickFirstEnabledModel(
  providers: { id: string; enabled: boolean; config: Record<string, unknown> | null }[],
): SelectedModel | null {
  for (const p of providers) {
    if (!p.enabled) continue;
    const enabledModels = (p.config as { enabledModels?: string[] } | null)?.enabledModels ?? [];
    if (enabledModels.length > 0) return { providerId: p.id, modelId: enabledModels[0] };
  }
  return null;
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-6 text-fg-tertiary text-sm">
      {children}
    </div>
  );
}
