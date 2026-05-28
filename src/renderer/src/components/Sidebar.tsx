import { Link } from '@tanstack/react-router';
import {
  Folder,
  FolderOpen,
  ListFilter,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react';
import { useState } from 'react';
import { MOCK_FLAT_CHATS, MOCK_PROJECTS } from '../lib/mock-data';

export function Sidebar(): React.JSX.Element {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [activeChatId, setActiveChatId] = useState<string | null>('fc-running');

  const toggleProject = (id: string): void => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border-default bg-surface">
      {/* macOS traffic-lights drag region — same surface bg as the rest of sidebar */}
      <div className="atrium-titlebar" />

      {/* Top nav: New chat + Search */}
      <nav className="flex shrink-0 flex-col gap-0.5 px-3 pt-2 pb-1">
        <SbNavItem icon={<SquarePen className="size-[15px] shrink-0" />} label="New chat" />
        <SbNavItem icon={<Search className="size-[15px] shrink-0" />} label="Search" />
      </nav>

      {/* Scrollable middle */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Projects section */}
        <SbSection
          label="Projects"
          hoverActions={
            <SbIconButton title="New project" icon={<Plus className="size-[13px]" />} />
          }
        />
        {MOCK_PROJECTS.map((proj) => {
          const collapsed = collapsedProjects.has(proj.id);
          const FolderIcon = collapsed ? Folder : FolderOpen;
          return (
            <div key={proj.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleProject(proj.id)}
                className="group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
              >
                <FolderIcon className="size-[15px] shrink-0 text-fg-tertiary group-hover:text-fg-secondary" />
                <span className="min-w-0 flex-1 truncate text-left">{proj.name}</span>
                <span className="flex gap-px opacity-0 transition-opacity group-hover:opacity-100">
                  <SbIconButton
                    title="New chat in project"
                    icon={<Plus className="size-[13px]" />}
                    small
                  />
                  <SbIconButton
                    title="More"
                    icon={<MoreHorizontal className="size-[13px]" />}
                    small
                  />
                </span>
              </button>
              {!collapsed && (
                <div className="mt-px pl-6">
                  {proj.chats.length === 0 ? (
                    <div className="px-3 py-1.5 text-fg-disabled text-sm">No chats</div>
                  ) : (
                    proj.chats.map((chat) => (
                      <button
                        type="button"
                        key={chat.id}
                        onClick={() => setActiveChatId(chat.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                          activeChatId === chat.id
                            ? 'bg-elevated text-fg-primary'
                            : 'text-fg-secondary hover:bg-surface-strong hover:text-fg-primary'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{chat.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Chats section */}
        <SbSection
          label="Chats"
          className="mt-4"
          hoverActions={
            <>
              <SbIconButton title="Sort / filter" icon={<ListFilter className="size-[13px]" />} />
              <SbIconButton title="New chat" icon={<SquarePen className="size-[13px]" />} />
            </>
          }
        />
        {MOCK_FLAT_CHATS.map((chat) => (
          <button
            type="button"
            key={chat.id}
            onClick={() => setActiveChatId(chat.id)}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
              activeChatId === chat.id
                ? 'bg-elevated text-fg-primary'
                : 'text-fg-secondary hover:bg-surface-strong hover:text-fg-primary'
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-left">{chat.name}</span>
            {chat.running ? (
              <span
                role="status"
                aria-label="Running"
                className="size-[13px] shrink-0 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent"
              />
            ) : (
              <span className="shrink-0 text-fg-disabled text-xs">{chat.ago}</span>
            )}
          </button>
        ))}
      </div>

      {/* Bottom: settings link */}
      <div className="shrink-0 border-t border-border-default px-3 py-2">
        <Link
          to="/settings/$section"
          params={{ section: 'general' }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <Settings className="size-[15px] shrink-0" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}

function SbNavItem({ icon, label }: { icon: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function SbSection({
  label,
  className,
  hoverActions,
}: {
  label: string;
  className?: string;
  hoverActions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`group flex items-center px-3 pt-3 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider ${className ?? ''}`}
    >
      <span className="flex-1">{label}</span>
      <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {hoverActions}
      </span>
    </div>
  );
}

function SbIconButton({
  title,
  icon,
  small = false,
}: {
  title: string;
  icon: React.ReactNode;
  small?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      className={`rounded text-fg-tertiary hover:bg-elevated hover:text-fg-primary ${small ? 'p-0.5' : 'p-1'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {icon}
    </button>
  );
}
