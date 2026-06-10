import { ChevronDown, Inbox } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// The server prefixes the persisted summary with this preamble (for the model);
// the divider already says "compacted", so we strip it from the shown body.
const PREAMBLE = 'Earlier conversation was compacted to save context. Summary of what came before:';

/**
 * Renders a persisted compaction checkpoint as a divider in the transcript:
 * a "Context compacted" rule the user can expand to read the summary that
 * replaced the folded-away messages.
 */
export function CompactionDivider({ summary }: { summary: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = summary.replace(PREAMBLE, '').trim();

  return (
    <div className="my-5">
      <div className="flex items-center gap-3 text-fg-tertiary">
        <div className="h-px flex-1 bg-border-default" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm hover:text-fg-secondary"
        >
          <Inbox className="size-3.5" />
          {t('trace.compacted')}
          <ChevronDown className={`size-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <div className="h-px flex-1 bg-border-default" />
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mt-3 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-default bg-surface px-4 py-3 text-fg-secondary text-sm leading-normal">
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Live "compacting…" indicator: a divider with static rules and a monochrome
 * shimmer-text label (no accent), shown inline while a fold runs.
 */
export function CompactionProgress(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-border-default" />
      <span className="compaction-shimmer shrink-0 text-sm">{t('trace.compacting')}</span>
      <div className="h-px flex-1 bg-border-default" />
    </div>
  );
}
