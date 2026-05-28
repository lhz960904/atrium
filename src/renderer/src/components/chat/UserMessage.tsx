export function UserMessage({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="mb-5 flex justify-end">
      <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-user-bubble-bg px-4 py-2.5 text-base text-user-bubble-fg leading-snug">
        {content}
      </div>
    </div>
  );
}
