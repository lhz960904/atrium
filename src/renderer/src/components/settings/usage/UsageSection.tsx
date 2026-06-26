import {
  CircleDollarSign,
  Hash,
  type LucideIcon,
  MessageSquare,
  Percent,
  PiggyBank,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatUsd } from '../../../lib/cost';
import { formatTokens } from '../../../lib/format';
import { trpc } from '../../../lib/trpc';
import { type UsageRange, useUsagePrefs } from '../../../state/usage-prefs-store';
import { DailyCostChart } from './DailyCostChart';
import { TokenHeatmap } from './TokenHeatmap';

type Range = UsageRange;

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-md border border-border-default p-0.5">
      {options.map((o) => (
        <button
          type="button"
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-xs ${
            value === o.id
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

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  feature,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  feature?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border p-4 ${
        feature ? 'border-accent/30 bg-accent-soft' : 'border-border-default bg-elevated'
      }`}
    >
      <div
        className={`flex items-center gap-1.5 font-medium text-xs ${feature ? 'text-accent' : 'text-fg-tertiary'}`}
      >
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={`mt-2.5 font-semibold text-2xl tracking-tight tabular-nums ${feature ? 'text-accent' : 'text-fg-primary'}`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-fg-tertiary text-xs tabular-nums">{sub}</div>}
    </div>
  );
}

function StatCards({ range }: { range: Range }): React.JSX.Element {
  const { t } = useTranslation();
  const { data } = trpc.usage.summary.useQuery({ range });
  const s = data;
  const pct = s ? Math.round(s.cacheHitRate * 100) : 0;
  const dash = '—';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatCard
        icon={CircleDollarSign}
        label={t('usage.cards.totalCost')}
        value={s ? formatUsd(s.totalCostUsd) : dash}
        sub={s ? t('usage.cards.calls', { count: s.calls }) : undefined}
      />
      <StatCard
        icon={Hash}
        label={t('usage.cards.totalTokens')}
        value={s ? formatTokens(s.totalTokens) : dash}
        sub={
          s
            ? t('usage.cards.inOut', {
                in: formatTokens(s.inputTokens),
                out: formatTokens(s.outputTokens),
              })
            : undefined
        }
      />
      <StatCard
        icon={PiggyBank}
        label={t('usage.cards.cacheSaved')}
        value={s ? formatUsd(s.cacheSavedUsd) : dash}
        sub={s ? t('usage.cards.hitRate', { pct }) : undefined}
        feature
      />
      <StatCard
        icon={MessageSquare}
        label={t('usage.cards.messages')}
        value={s ? String(s.calls) : dash}
        sub={
          s ? t('usage.cards.callSplit', { chat: s.chatCalls, sub: s.subagentCalls }) : undefined
        }
      />
      <StatCard
        icon={Percent}
        label={t('usage.cards.cacheHit')}
        value={s ? `${pct}%` : dash}
        sub={
          s
            ? t('usage.cards.cachedOf', {
                read: formatTokens(s.cacheReadTokens),
                input: formatTokens(s.inputTokens),
              })
            : undefined
        }
      />
    </div>
  );
}

export function UsageSection(): React.JSX.Element {
  const { t } = useTranslation();
  const range = useUsagePrefs((s) => s.range);
  const setRange = useUsagePrefs((s) => s.setRange);
  const ranges: Array<{ id: Range; label: string }> = [
    { id: '7d', label: t('usage.range.7d') },
    { id: '30d', label: t('usage.range.30d') },
    { id: 'month', label: t('usage.range.month') },
    { id: 'year', label: t('usage.range.year') },
    { id: 'all', label: t('usage.range.all') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-fg-tertiary text-xs leading-snug">{t('usage.note')}</p>
        <Segmented value={range} options={ranges} onChange={setRange} />
      </div>

      <StatCards range={range} />

      <div className="rounded-xl border border-border-default bg-elevated p-5">
        <div className="mb-4">
          <h2 className="font-medium text-fg-primary text-sm">{t('usage.heatmap.title')}</h2>
          <p className="mt-0.5 text-fg-tertiary text-xs">{t('usage.heatmap.desc')}</p>
        </div>
        <div className="overflow-x-auto">
          <TokenHeatmap />
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-elevated p-5">
        <DailyCostChart range={range} />
      </div>
    </div>
  );
}
