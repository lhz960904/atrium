import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../main/trpc/router';

type SearchHit = inferRouterOutputs<AppRouter>['search']['chats']['hits'][number];
export type Snippet = NonNullable<SearchHit['snippet']>;

/** Render a snippet's window with its matched ranges wrapped as highlights. */
export function SnippetText({ snippet }: { snippet: Snippet }): React.JSX.Element {
  return (
    <>
      {snippet.truncatedStart && '…'}
      <Highlighted text={snippet.text} ranges={snippet.highlights} />
      {snippet.truncatedEnd && '…'}
    </>
  );
}

function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: [number, number][];
}): React.JSX.Element {
  if (ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const [s, e] of ranges) {
    if (s > cursor) out.push(text.slice(cursor, s));
    // Ranges are sorted and non-overlapping, so the start offset is a stable key.
    out.push(
      <mark key={s} className="rounded-[2px] bg-accent/20 text-fg-primary">
        {text.slice(s, e)}
      </mark>,
    );
    cursor = e;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}
