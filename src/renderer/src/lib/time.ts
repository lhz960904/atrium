function toStamp(date: Date | number | string): number {
  return typeof date === 'number'
    ? date
    : typeof date === 'string'
      ? new Date(date).getTime()
      : date.getTime();
}

/** Codex-style short time-ago: 5m / 2h / 3d / 1w / 2mo */
export function timeAgo(date: Date | number | string): string {
  const ms = Date.now() - toStamp(date);
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

/** Absolute, localized date + time: "Jun 6, 2026, 11:09 PM" / "2026年6月6日 23:09". */
export function formatDateTime(date: Date | number | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    toStamp(date),
  );
}
