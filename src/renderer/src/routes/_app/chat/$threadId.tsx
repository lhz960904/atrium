import type { ChatMessage, Thread, Trace } from '@shared/chat-types';
import { createFileRoute } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../../main/trpc/router';
import { ChatThread } from '../../../components/chat/ChatThread';
import { trpc } from '../../../lib/trpc';

export const Route = createFileRoute('/_app/chat/$threadId')({
  component: ChatView,
});

function ChatView(): React.JSX.Element {
  const { threadId } = Route.useParams();
  const { data, isLoading } = trpc.threads.get.useQuery({ id: threadId });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-fg-tertiary text-sm">Loading…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <p className="text-fg-tertiary text-sm">对话不存在</p>
          <p className="mt-1 font-mono text-fg-disabled text-xs">{threadId}</p>
        </div>
      </div>
    );
  }

  return <ChatThread thread={adaptDbThread(data)} />;
}

/**
 * Temporary adapter: db row → chat-types Thread.
 *
 * Step 5 (agent loop landing) will replace both sides with the Vercel AI SDK
 * UIMessage shape, at which point this function disappears.
 */
type DbThread = NonNullable<inferRouterOutputs<AppRouter>['threads']['get']>;

function adaptDbThread(dbThread: DbThread): Thread {
  return {
    id: dbThread.id,
    title: dbThread.title ?? '未命名对话',
    messages: dbThread.messages.flatMap((m): ChatMessage[] => {
      if (m.role === 'user') {
        const parts = m.parts as { content: string };
        return [{ id: m.id, role: 'user', content: parts.content }];
      }
      if (m.role === 'assistant') {
        return [{ id: m.id, role: 'assistant', trace: m.parts as Trace }];
      }
      // system: skip from chat rendering
      return [];
    }),
  };
}
