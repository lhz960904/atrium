import type { AtriumUIMessage } from '@shared/chat';
import type { ChatStatus } from 'ai';
import { useEffect, useRef } from 'react';
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Pin the view to the newest content as it streams — unless the user has
  // scrolled up to read earlier messages, in which case leave them be.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div className="flex h-full flex-col">
      <ChatHeader title={title} />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-2 py-6">
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
