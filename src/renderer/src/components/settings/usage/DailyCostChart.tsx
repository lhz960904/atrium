import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatUsd } from '../../../lib/cost';
import { trpc } from '../../../lib/trpc';
import { useUsagePrefs } from '../../../state/usage-prefs-store';

type Range = '7d' | '30d' | 'month' | 'year' | 'all';
type Mode = 'total' | 'byModel';

// Per-model bar colors, cycled. CSS vars resolve live against the active theme.
const MODEL_COLORS = [
  'var(--accent-default)',
  'var(--accent-alt)',
  'var(--status-success)',
  'var(--status-info)',
  'var(--status-warning)',
  'var(--accent-active)',
];

const prettyDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const axisTick = { fill: 'var(--fg-tertiary)', fontSize: 11 };
const tooltipStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--fg-primary)',
} as const;

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const opts: Array<{ id: Mode; label: string }> = [
    { id: 'total', label: t('usage.chart.total') },
    { id: 'byModel', label: t('usage.chart.byModel') },
  ];
  return (
    <div className="inline-flex rounded-md border border-border-default p-0.5">
      {opts.map((o) => (
        <button
          type="button"
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-xs ${
            mode === o.id
              ? 'bg-elevated text-fg-primary'
              : 'text-fg-tertiary hover:text-fg-secondary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DailyCostChart({ range }: { range: Range }): React.JSX.Element {
  const { t } = useTranslation();
  const mode = useUsagePrefs((s) => s.chartMode);
  const setMode = useUsagePrefs((s) => s.setChartMode);
  const total = trpc.usage.daily.useQuery({ range }, { enabled: mode === 'total' });
  const byModel = trpc.usage.dailyByModel.useQuery({ range }, { enabled: mode === 'byModel' });

  const wide = useMemo(() => {
    if (!byModel.data) return [];
    const byDate = new Map<string, Record<string, number | string>>();
    for (const r of byModel.data.rows) {
      const e = byDate.get(r.date) ?? { date: r.date };
      e[r.modelId] = r.costUsd;
      byDate.set(r.date, e);
    }
    return [...byDate.values()];
  }, [byModel.data]);

  const loading = mode === 'total' ? !total.data : !byModel.data;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium text-fg-primary text-sm">{t('usage.chart.title')}</h2>
          <p className="mt-0.5 text-fg-tertiary text-xs">{t('usage.chart.desc')}</p>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {loading ? (
        <div className="h-[220px] animate-pulse rounded-md bg-surface-strong" />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={mode === 'total' ? (total.data ?? []) : wide}
            margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border-default)" />
            <XAxis
              dataKey="date"
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-default)' }}
              tickFormatter={prettyDate}
              minTickGap={28}
            />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => formatUsd(v)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'var(--accent-soft)' }}
              labelFormatter={(l) => prettyDate(String(l))}
              formatter={(v, name) => [formatUsd(Number(v)), name]}
            />
            {mode === 'total' ? (
              <Bar
                dataKey="costUsd"
                name={t('usage.chart.cost')}
                fill="var(--accent-default)"
                radius={[2, 2, 0, 0]}
              />
            ) : (
              byModel.data?.models.map((m, i) => (
                <Bar
                  key={m}
                  dataKey={m}
                  name={m}
                  stackId="cost"
                  fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                  radius={i === (byModel.data?.models.length ?? 0) - 1 ? [2, 2, 0, 0] : undefined}
                />
              ))
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
