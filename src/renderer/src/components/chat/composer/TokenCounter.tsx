import type { AtriumUIMessage } from '@shared/chat';
import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { aggregateUsage, contextOccupancy, formatUsd, sessionModelIds } from '../../../lib/cost';
import { formatTokens } from '../../../lib/format';
import { trpc } from '../../../lib/trpc';
import { Tooltip } from '../../Tooltip';

// Context-window fill turns the readout amber as it nears the limit, red at the
// point auto-compaction kicks in (DEFAULT_COMPACT_AT_RATIO = 0.8) — a glanceable
// "how much room is left" signal.
const CONTEXT_WARN_PCT = 70;
const CONTEXT_DANGER_PCT = 80;

function occupancyColor(pct: number): string {
  if (pct >= CONTEXT_DANGER_PCT) return 'text-danger';
  if (pct >= CONTEXT_WARN_PCT) return 'text-warning';
  return 'text-fg-tertiary hover:text-fg-secondary';
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className={`flex justify-between gap-6 ${strong ? 'font-medium text-fg-primary' : ''}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

/**
 * Session token + cost readout for the composer toolbar. Sums the thread's
 * assistant turns (each priced at its own model's rates), shows context-window
 * fill from the latest turn, and breaks the numbers down on hover. Renders
 * nothing until a turn has produced usage.
 */
export function TokenCounter({
  messages,
}: {
  messages: AtriumUIMessage[];
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const modelIds = sessionModelIds(messages);
  const info = trpc.models.info.useQuery(
    { modelIds },
    { enabled: modelIds.length > 0, staleTime: 5 * 60_000 },
  );
  const agg = aggregateUsage(messages, info.data);
  const occ = contextOccupancy(messages, info.data);
  if (agg.totalTokens === 0) return null;

  const showCost = agg.costComplete && agg.totalCost > 0;

  const body = (
    <div className="min-w-[180px] text-left text-fg-secondary">
      {occ && occ.max > 0 && (
        <>
          <Row
            label={t('tokenCounter.context')}
            value={`${formatTokens(occ.used)} / ${formatTokens(occ.max)} · ${occ.pct}%`}
          />
          <div className="my-1.5 h-px bg-border-default" />
        </>
      )}
      <Row label={t('tokenCounter.input')} value={formatTokens(agg.inputTokens)} />
      <Row label={t('tokenCounter.output')} value={formatTokens(agg.outputTokens)} />
      <Row label={t('tokenCounter.cached')} value={formatTokens(agg.cacheReadTokens)} />
      <Row label={t('tokenCounter.total')} value={formatTokens(agg.totalTokens)} strong />
      {showCost && (
        <>
          <div className="my-1.5 h-px bg-border-default" />
          <Row label={t('tokenCounter.inputCost')} value={formatUsd(agg.inputCost)} />
          <Row label={t('tokenCounter.outputCost')} value={formatUsd(agg.outputCost)} />
          <Row label={t('tokenCounter.cacheCost')} value={formatUsd(agg.cacheCost)} />
          <Row label={t('tokenCounter.totalCost')} value={formatUsd(agg.totalCost)} strong />
        </>
      )}
      <div className="mt-1 text-fg-disabled">{t('tokenCounter.estimate')}</div>
    </div>
  );

  const hasPct = occ != null && occ.max > 0;
  const color = hasPct ? occupancyColor(occ.pct) : 'text-fg-tertiary hover:text-fg-secondary';

  return (
    <Tooltip content={body}>
      <span
        className={`inline-flex h-7 cursor-default items-center gap-1.5 rounded-md px-2.5 text-xs leading-none hover:bg-elevated ${color}`}
      >
        <Gauge className="size-4 shrink-0" />
        <span>{hasPct ? `${occ.pct}%` : formatTokens(agg.totalTokens)}</span>
      </span>
    </Tooltip>
  );
}
