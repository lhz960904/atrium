import type { Thread } from '../../lib/chat-types';
import { AssistantMessage } from './AssistantMessage';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { UserMessage } from './UserMessage';

export function ChatThread({ thread }: { thread: Thread }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <ChatHeader title={thread.title} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-6">
          {thread.messages.map((msg) =>
            msg.role === 'user' ? (
              <UserMessage key={msg.id} content={msg.content} />
            ) : (
              <AssistantMessage key={msg.id} trace={msg.trace} />
            ),
          )}
        </div>
      </div>
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[760px]">
          <Composer />
        </div>
      </div>
    </div>
  );
}
