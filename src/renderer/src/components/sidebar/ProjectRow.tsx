import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Folder, FolderOpen, SquarePen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectMenu } from './ProjectMenu';
import { RowAction } from './primitives';
import type { ProjectItem, ThreadItem } from './types';

export function ProjectRow({
  project,
  expanded,
  onToggle,
  threads,
  renderThread,
}: {
  project: ProjectItem;
  expanded: boolean;
  onToggle: () => void;
  threads: ThreadItem[];
  renderThread: (thread: ThreadItem) => React.JSX.Element;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div>
      <div className="group flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-sidebar-item-hover hover:text-fg-primary">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <FolderOpen className="size-[15px] shrink-0" />
          ) : (
            <Folder className="size-[15px] shrink-0" />
          )}
          <span className="min-w-0 truncate">{project.name}</span>
          {expanded ? (
            <ChevronDown className="size-[14px] shrink-0 text-fg-tertiary" />
          ) : (
            <ChevronRight className="size-[14px] shrink-0 text-fg-tertiary" />
          )}
        </button>
        {/* Stay visible while the menu is open: a display:none trigger loses
            radix's anchor, so the popover would jump to the top-left corner. */}
        <span
          className={`shrink-0 items-center gap-0.5 ${menuOpen ? 'flex' : 'hidden group-hover:flex'}`}
        >
          <ProjectMenu project={project} open={menuOpen} onOpenChange={setMenuOpen} />
          <RowAction
            title={t('home.newChat')}
            icon={<SquarePen className="size-[13px]" />}
            // Project-scoped chat creation lands in a later step; for now this
            // opens a new chat from home.
            onClick={() => navigate({ to: '/' })}
          />
        </span>
      </div>
      {/* grid 0fr→1fr animates the open/close height; content always renders so it can slide. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          {threads.length === 0 ? (
            <div className="px-3 py-1 pl-8 text-fg-disabled text-sm">
              {t('sidebar.projectNoChats')}
            </div>
          ) : (
            <div className="flex flex-col gap-1 pl-3">{threads.map(renderThread)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
