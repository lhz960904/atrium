import { useState } from 'react';
import { LiveLabel } from './LiveLabel';

/** Loading shown after a turn is submitted but before the first token arrives —
 *  external CLI agents (and slow first tokens generally) leave the assistant
 *  area empty for seconds, so this fills it with the same "Working… Xs" the
 *  trace header uses. Mounts when shown, so the ticker counts from then. */
export function TurnLoading(): React.JSX.Element {
  const [start] = useState(() => Date.now());
  return (
    <div className="mb-7 inline-flex items-center gap-2 py-1 text-fg-secondary text-md">
      <span className="size-2 animate-pulse rounded-full bg-accent" />
      <LiveLabel verb="Working" createdAt={start} />
    </div>
  );
}
