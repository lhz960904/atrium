import { Markdown } from './Markdown';

export function NarrativeSegment({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}): React.JSX.Element {
  // Streamdown renders partial Markdown as it streams, so narrative formats
  // live instead of showing raw source until the turn ends.
  return (
    <div className="my-3 text-fg-secondary">
      <Markdown streaming={streaming}>{content}</Markdown>
    </div>
  );
}
