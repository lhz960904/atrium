import type { AtriumUIMessage } from '@shared/chat';
import type { ChatStatus } from 'ai';
import { AssistantMessage } from './AssistantMessage';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { UserMessage } from './UserMessage';

export function ChatThread({
  title,
  messages,
  status,
  onSend,
}: {
  title: string;
  messages: AtriumUIMessage[];
  status: ChatStatus;
  onSend: (text: string) => void;
}): React.JSX.Element {
  const live = status === 'submitted' || status === 'streaming';
  const lastId = messages.at(-1)?.id;
  return (
    <div className="flex h-full flex-col">
      <ChatHeader title={title} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-6">
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserMessage key={msg.id} parts={msg.parts} />
            ) : (
              <AssistantMessage key={msg.id} message={msg} streaming={live && msg.id === lastId} />
            ),
          )}
        </div>
      </div>
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[760px]">
          <Composer
            disabled={status === 'submitted' || status === 'streaming'}
            onSubmit={(text) => onSend(text)}
          />
        </div>
      </div>
    </div>
  );
}
