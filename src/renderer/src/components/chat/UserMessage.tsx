import type { AtriumUIMessage } from '@shared/chat';

export function UserMessage({ parts }: { parts: AtriumUIMessage['parts'] }): React.JSX.Element {
  const text = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
  return (
    <div className="mb-5 flex justify-end">
      <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-user-bubble-bg px-4 py-2.5 text-base text-user-bubble-fg leading-snug">
        {text}
      </div>
    </div>
  );
}
