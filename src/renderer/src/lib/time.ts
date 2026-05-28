/** Codex-style short time-ago: 5m / 2h / 3d / 1w / 2mo */
export function timeAgo(date: Date | number | string): string {
  const stamp =
    typeof date === 'number'
      ? date
      : typeof date === 'string'
        ? new Date(date).getTime()
        : date.getTime();
  const ms = Date.now() - stamp;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w`;
  const month = Math.floor(day / 30);
  return `${month}mo`;
}
