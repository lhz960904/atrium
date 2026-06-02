import type { AtriumUIMessage } from '@shared/chat';
import type { Todo } from '@shared/chat-types';
import type { ChatStatus } from 'ai';
import { useEffect, useRef } from 'react';
import { AssistantMessage } from './AssistantMessage';
import { ChatHeader } from './ChatHeader';
import { CompactionDivider, CompactionProgress } from './CompactionDivider';
import { Composer } from './Composer';
import { PlanPanel } from './PlanPanel';
import { UserMessage } from './UserMessage';

function messageText(parts: AtriumUIMessage['parts']): string {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export function ChatThread({
  title,
  messages,
  status,
  compacting,
  plan,
  onSend,
}: {
  title: string;
  messages: AtriumUIMessage[];
  status: ChatStatus;
  /** Whether the context is being compacted right now (live indicator). */
  compacting: boolean;
  /** The thread's active plan (latest todo_write); null when none. */
  plan: Todo[] | null;
  onSend: (text: string) => void;
}): React.JSX.Element {
  const live = status === 'submitted' || status === 'streaming';
  const lastId = messages.at(-1)?.id;

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Pin the view to the newest content as it streams — unless the user has
  // scrolled up to read earlier messages, in which case leave them be.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is the intended trigger to re-pin on new content
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
          {messages.map((msg) => {
            const kind = msg.metadata?.kind;
            // The ack is an internal alternation placeholder — never shown.
            if (kind === 'compaction-ack') return null;
            if (kind === 'compaction') {
              return <CompactionDivider key={msg.id} summary={messageText(msg.parts)} />;
            }
            return msg.role === 'user' ? (
              <UserMessage key={msg.id} parts={msg.parts} />
            ) : (
              <AssistantMessage key={msg.id} message={msg} streaming={live && msg.id === lastId} />
            );
          })}
          {compacting && <CompactionProgress />}
        </div>
      </div>
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[760px]">
          {plan != null && <PlanPanel todos={plan} />}
          <Composer
            disabled={status === 'submitted' || status === 'streaming'}
            attachedTop={plan != null}
            onSubmit={(text) => onSend(text)}
          />
        </div>
      </div>
    </div>
  );
}
