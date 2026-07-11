import type { Tool } from '@shared/chat-types';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toolIcon } from '../../lib/tool-presentation';
import { useAutoReviewStore } from '../../state/auto-review-store';
import { ToolExpand } from './ToolExpand';

export function ToolMarker({ tool }: { tool: Tool }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(tool.name);
  const autoReviewed = useAutoReviewStore((s) => s.ids.has(tool.id));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/tool flex w-full items-center gap-3 py-1 text-fg-secondary text-md hover:text-fg-primary"
      >
        <Icon className="size-4 shrink-0 text-fg-tertiary group-hover/tool:text-fg-secondary" />
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="text-fg-tertiary">{tool.verb}</span> <span>{tool.target}</span>
        </span>
        {autoReviewed && (
          <span
            title={t('approval.autoReviewed')}
            className="inline-flex shrink-0 items-center gap-1 text-success text-xs"
          >
            <ShieldCheck className="size-3.5" />
          </span>
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 text-fg-tertiary opacity-0 transition group-hover/tool:opacity-100 ${
            open ? 'rotate-180 opacity-100' : ''
          }`}
        />
      </button>
      {open && <ToolExpand tool={tool} />}
    </>
  );
}
