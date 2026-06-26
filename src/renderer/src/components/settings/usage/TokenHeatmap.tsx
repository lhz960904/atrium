import { useMemo } from 'react';
import { type Activity, ActivityCalendar } from 'react-activity-calendar';
import 'react-activity-calendar/tooltips.css';
import { useTranslation } from 'react-i18next';
import { formatUsd } from '../../../lib/cost';
import { formatTokens } from '../../../lib/format';
import { trpc } from '../../../lib/trpc';
import { useThemeStore } from '../../../state/theme-store';

type Daily = { date: string; tokens: number; costUsd: number };

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prettyDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function levelOf(tokens: number, max: number): number {
  const r = tokens / max;
  if (r > 0.66) return 4;
  if (r > 0.4) return 3;
  if (r > 0.15) return 2;
  return 1;
}

/** Build the calendar series + a date→cost lookup, padded to a full trailing year. */
function buildActivities(daily: Daily[]): { activities: Activity[]; cost: Map<string, number> } {
  const cost = new Map(daily.map((d) => [d.date, d.costUsd]));
  const seen = new Set(daily.map((d) => d.date));
  const max = Math.max(1, ...daily.map((d) => d.tokens));
  const activities: Activity[] = daily
    .filter((d) => d.tokens > 0)
    .map((d) => ({ date: d.date, count: d.tokens, level: levelOf(d.tokens, max) }));
  // Empty boundary entries fix the grid to the trailing 12 months.
  const today = isoDate(new Date());
  const start = isoDate(new Date(Date.now() - 364 * 86_400_000));
  if (!seen.has(start)) activities.push({ date: start, count: 0, level: 0 });
  if (!seen.has(today)) activities.push({ date: today, count: 0, level: 0 });
  activities.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { activities, cost };
}

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Five-step scale (empty → accent) resolved from the active theme's CSS vars.
 *  `theme` is unused but ties the result to the active theme so callers recompute
 *  when it flips (the CSS vars getComputedStyle reads change with data-theme). */
function heatmapColors(_theme: string): string[] {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent-default').trim() || '#2383E2';
  const empty = cs.getPropertyValue('--bg-surface-strong').trim() || '#EEE';
  return [empty, rgba(accent, 0.24), rgba(accent, 0.46), rgba(accent, 0.7), accent];
}

export function TokenHeatmap(): React.JSX.Element {
  const { t } = useTranslation();
  // Re-resolve colors when the theme changes (CSS vars flip with data-theme).
  const theme = useThemeStore((s) => s.theme);
  const daily = trpc.usage.daily.useQuery({ range: 'year' });
  const { activities, cost } = useMemo(() => buildActivities(daily.data ?? []), [daily.data]);
  const colors = useMemo(() => heatmapColors(theme), [theme]);

  if (!daily.data) {
    return <div className="h-[140px] animate-pulse rounded-md bg-surface-strong" />;
  }

  return (
    <ActivityCalendar
      data={activities}
      theme={{ light: colors, dark: colors }}
      blockSize={12}
      blockMargin={3}
      blockRadius={3}
      fontSize={12}
      maxLevel={4}
      showWeekdayLabels={false}
      labels={{ totalCount: t('usage.heatmap.total') }}
      tooltips={{
        activity: {
          text: (a) =>
            a.count > 0
              ? `${formatTokens(a.count)} tokens · ${formatUsd(cost.get(a.date) ?? 0)} on ${prettyDate(a.date)}`
              : `${t('usage.heatmap.noActivity')} ${prettyDate(a.date)}`,
        },
      }}
    />
  );
}
