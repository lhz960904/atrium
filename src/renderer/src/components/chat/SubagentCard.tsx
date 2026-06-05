import * as Collapsible from '@radix-ui/react-collapsible';
import type { SubagentActivityTool } from '@shared/chat';
import type { Subagent, SubagentStatus } from '@shared/chat-types';
import { Ban, Bot, ChevronDown, Loader2, Wrench } from 'lucide-react';
import { useState } from 'react';
import {
  type MarkerToolName,
  TOOL_PRESENTATION,
  type ToolInput,
} from '../../lib/tool-presentation';
import { useSubagentStore } from '../../state/subagent-store';
import { Markdown } from './Markdown';

/** One subagent tool call as a static line (icon + verb + target) — not the
 *  expandable ToolMarker; the subagent's per-tool detail/output isn't shown. */
function SubagentToolLine({ tool }: { tool: SubagentActivityTool }): React.JSX.Element {
  const input = (tool.input ?? {}) as ToolInput;
  const p = TOOL_PRESENTATION[tool.name as MarkerToolName];
  const Icon = p.icon;
  return (
    <div className="flex items-center gap-2.5 py-1 text-fg-secondary text-md">
      <Icon className="size-4 shrink-0 text-fg-tertiary" />
      <span className="min-w-0 truncate">
        <span className="text-fg-tertiary">{p.verb}</span> {p.target(input)}
      </span>
    </div>
  );
}

export function SubagentCard({ subagent }: { subagent: Subagent }): React.JSX.Element {
  // The subagent's own activity lives in the store (keyed by the task call id),
  // not in the message. With no live entry (e.g. after a reload — activity isn't
  // persisted), fall back to the part-derived status + final returned text.
  const entry = useSubagentStore((s) => s.byId[subagent.id]);
  const status = entry?.status ?? subagent.status;
  const tools = entry?.tools ?? [];
  const toolCount = tools.length;

  // Default open while streaming so the user can watch progress; default
  // closed after completion. User can always toggle.
  const [open, setOpen] = useState(status === 'streaming');

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={`my-3 overflow-hidden rounded-lg border bg-elevated transition-colors ${
        open ? 'border-border-strong' : 'border-border-default'
      }`}
    >
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface ${
            open ? 'border-border-default border-b' : ''
          }`}
        >
          <Bot className="size-4 shrink-0 text-fg-secondary" />
          <span className="min-w-0 flex-1 truncate font-medium text-base text-fg-primary">
            {subagent.name}
          </span>
          <SubagentBadge status={status} />
          {/* Only when the live activity is around — after a reload the count
              isn't persisted, so showing "0 tools" would read as a bug. */}
          {entry && <ToolCountChip count={toolCount} />}
          <ChevronDown
            className={`size-3.5 shrink-0 text-fg-tertiary transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </Collapsible.Trigger>
      {(entry || subagent.result) && (
        <Collapsible.Content className="atrium-collapsible">
          <div className="atrium-tool-output max-h-[360px] overflow-y-auto px-4 py-3">
            {entry ? (
              tools.map((t) => <SubagentToolLine key={t.id} tool={t} />)
            ) : subagent.result ? (
              <div className="text-fg-secondary">
                <Markdown>{subagent.result}</Markdown>
              </div>
            ) : null}
          </div>
        </Collapsible.Content>
      )}
    </Collapsible.Root>
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
