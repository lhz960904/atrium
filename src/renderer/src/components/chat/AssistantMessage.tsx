export function AssistantMessage({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="mb-7 whitespace-pre-wrap text-base text-fg-primary leading-relaxed">
      {content}
    </div>
  );
}
