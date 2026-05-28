export function NarrativeSegment({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="my-3 whitespace-pre-wrap text-base text-fg-primary leading-relaxed">
      {content}
    </div>
  );
}
