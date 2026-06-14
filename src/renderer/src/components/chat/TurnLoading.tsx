import { useTranslation } from 'react-i18next';

/** Loading shown after a turn is submitted but before the assistant produces
 *  anything, so the turn is never blank. */
export function TurnLoading(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mb-7 inline-flex items-center gap-2 py-1 text-fg-secondary text-md">
      <span className="size-2 animate-pulse rounded-full bg-accent" />
      <span>{t('trace.thinking')}…</span>
    </div>
  );
}
