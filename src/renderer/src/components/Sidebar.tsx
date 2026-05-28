import { Link } from '@tanstack/react-router';
import { ListFilter, Search, Settings, SquarePen } from 'lucide-react';
import { timeAgo } from '../lib/time';
import { trpc } from '../lib/trpc';

const chatRowBase =
  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-fg-secondary hover:bg-surface-strong hover:text-fg-primary';
const chatRowActive =
  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm bg-elevated text-fg-primary';

export function Sidebar(): React.JSX.Element {
  const { data: threads, isLoading } = trpc.threads.list.useQuery();

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border-default bg-surface">
      <div className="atrium-titlebar" />

      <nav className="flex shrink-0 flex-col gap-0.5 px-3 pt-2 pb-1">
        <Link
          to="/"
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <SquarePen className="size-[15px] shrink-0" />
          <span className="flex-1 text-left">New chat</span>
        </Link>
        <SbNavItem icon={<Search className="size-[15px] shrink-0" />} label="Search" />
      </nav>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SbSection
          label="Chats"
          hoverActions={
            <>
              <SbIconButton title="Sort / filter" icon={<ListFilter className="size-[13px]" />} />
              <SbIconButton title="New chat" icon={<SquarePen className="size-[13px]" />} />
            </>
          }
        />
        {isLoading ? (
          <div className="px-3 py-1.5 text-fg-disabled text-sm">Loading…</div>
        ) : !threads || threads.length === 0 ? (
          <div className="px-3 py-1.5 text-fg-disabled text-sm">No chats yet</div>
        ) : (
          threads.map((t) => (
            <Link
              key={t.id}
              to="/chat/$threadId"
              params={{ threadId: t.id }}
              className={chatRowBase}
              activeProps={{ className: chatRowActive }}
            >
              <span className="min-w-0 flex-1 truncate text-left">{t.title ?? '未命名对话'}</span>
              <span className="shrink-0 text-fg-disabled text-xs">{timeAgo(t.updatedAt)}</span>
            </Link>
          ))
        )}
      </div>

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
