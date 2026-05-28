import { Ban, Box, ChevronDown, Loader2, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { Subagent, SubagentStatus } from '../../lib/chat-types';
import { SegmentList } from './SegmentList';

export function SubagentCard({ subagent }: { subagent: Subagent }): React.JSX.Element {
  // Default open while streaming so the user can watch progress; default
  // closed after completion. User can always toggle.
  const [open, setOpen] = useState(subagent.status === 'streaming');

  return (
    <div
      className={`my-3 overflow-hidden rounded-lg border bg-elevated transition-colors ${
        open ? 'border-border-strong' : 'border-border-default'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface ${
          open ? 'border-border-default border-b' : ''
        }`}
      >
        <Box className="size-4 shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1 truncate font-medium text-base text-fg-primary">
          {subagent.name}
        </span>
        <SubagentBadge status={subagent.status} />
        <ToolCountChip count={subagent.toolCount} />
        <ChevronDown
          className={`size-3.5 shrink-0 text-fg-tertiary transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-4 py-3">
          <SegmentList segments={subagent.body} />
        </div>
      )}
    </div>
  );
}

function SubagentBadge({ status }: { status: SubagentStatus }): React.JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${meta.cls}`}
    >
      {meta.kind === 'pulse' && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {meta.kind === 'dot' && <span className="size-1.5 rounded-full bg-current" />}
      {meta.kind === 'icon' && meta.icon && <meta.icon className="size-3" />}
      <span>{meta.label}</span>
    </span>
  );
}

const STATUS_META: Record<
  SubagentStatus,
  {
    label: string;
    cls: string;
    kind: 'pulse' | 'dot' | 'icon';
    icon?: typeof Loader2;
  }
> = {
  streaming: {
    label: 'Streaming',
    cls: 'bg-accent-alt-soft text-accent-alt',
    kind: 'pulse',
  },
  done: {
    label: 'Done',
    cls: 'bg-[rgba(74,159,96,0.10)] text-success dark:bg-[rgba(111,213,131,0.16)] dark:text-[#6FD583]',
    kind: 'dot',
  },
  failed: {
    label: 'Failed',
    cls: 'bg-[rgba(208,74,74,0.10)] text-danger',
    kind: 'icon',
    icon: Loader2,
  },
  cancelled: {
    label: 'Cancelled',
    cls: 'bg-surface text-fg-disabled',
    kind: 'icon',
    icon: Ban,
  },
};

function ToolCountChip({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-medium text-fg-tertiary text-xs">
      <Wrench className="size-2.5" />
      <span>
        {count} {count === 1 ? 'tool' : 'tools'}
      </span>
    </span>
  );
}
