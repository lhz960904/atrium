import { createFileRoute } from '@tanstack/react-router';
import { ChatThread } from '../../../components/chat/ChatThread';
import { getMockThread } from '../../../lib/mock-threads';

export const Route = createFileRoute('/_app/chat/$threadId')({
  component: ChatView,
});

function ChatView(): React.JSX.Element {
  const { threadId } = Route.useParams();
  const thread = getMockThread(threadId);

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <p className="text-fg-tertiary text-sm">
            对话{' '}
            <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{threadId}</code>{' '}
            暂无 mock 内容
          </p>
          <p className="mt-1 text-fg-disabled text-xs">真实数据接通后这条会变成真的对话</p>
        </div>
      </div>
    );
  }

  return <ChatThread thread={thread} />;
}
