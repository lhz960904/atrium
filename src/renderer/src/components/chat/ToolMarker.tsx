import type { Tool } from '@shared/chat-types';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { ToolExpand } from './ToolExpand';
import { TOOL_ICONS } from './tool-icons';

export function ToolMarker({ tool }: { tool: Tool }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[tool.kind];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-3 py-1 text-fg-secondary text-md hover:text-fg-primary"
      >
        <Icon className="size-4 shrink-0 text-fg-tertiary group-hover:text-fg-secondary" />
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="text-fg-tertiary">{tool.verb}</span> <span>{tool.target}</span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-fg-tertiary opacity-0 transition group-hover:opacity-100 ${
            open ? 'rotate-180 opacity-100' : ''
          }`}
        />
      </button>
      {open && <ToolExpand tool={tool} />}
    </>
  );
}
