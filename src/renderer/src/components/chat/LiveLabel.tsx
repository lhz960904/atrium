import { useEffect, useState } from 'react';

/** A live "<verb>… <elapsed>" label that ticks every second from `createdAt`.
 *  Shared by the trace header ("Thinking…/Working…") and the pre-first-token
 *  turn-loading indicator. */
export function LiveLabel({
  verb,
  createdAt,
}: {
  verb: string;
  createdAt?: number;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Hold off on the timer until at least a second has elapsed — no flash of "0s".
  const sec = createdAt != null ? Math.max(0, Math.floor((now - createdAt) / 1000)) : 0;
  return (
    <span>
      {verb}…{sec > 0 ? ` ${formatLive(sec)}` : ''}
    </span>
  );
}

function formatLive(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
}
