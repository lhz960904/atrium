import { Link, useNavigate } from '@tanstack/react-router';
import { FolderPlus, Search, Settings, SquarePen } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { useCommandPalette } from '../../state/command-palette-store';
import { useSidebarStore } from '../../state/sidebar-store';
import { ProjectRow } from './ProjectRow';
import { SbIconButton, SbNavItem, SbSection } from './primitives';
import { ThreadRow } from './ThreadRow';
import type { ProjectItem, ThreadItem } from './types';

export const Sidebar = memo(function Sidebar(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const width = useSidebarStore((s) => s.width);
  const openPalette = useCommandPalette((s) => s.setOpen);
  const utils = trpc.useUtils();
  const { data: threads, isLoading } = trpc.threads.list.useQuery();
  const { data: projects } = trpc.projects.list.useQuery();
  // Poll the main process for which threads are generating; a small id list, so
  // the interval is cheap (unlike polling message content).
  const { data: running } = trpc.threads.running.useQuery(undefined, { refetchInterval: 2000 });
  const runningSet = new Set(running);

  // Adding a project is a sidebar-level action (the Projects header button), not
  // tied to any one row, so it lives here; per-project actions live in ProjectMenu.
  const pickDirectory = trpc.projects.pickDirectory.useMutation();
  const addProject = trpc.projects.add.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
  });
  const onAddProject = async (): Promise<void> => {
    const path = await pickDirectory.mutateAsync();
    if (path) addProject.mutate({ path });
  };

  // Collapse state is held centrally so it survives a project moving between the
  // Pinned and Projects sections (which remounts the row) on pin/unpin.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A background run has no client mounted to refresh the list when it finishes,
  // so its unread dot would lag until a manual refresh. Watch the polled running
  // set: when a thread drops out of it, it just completed — refetch the list so
  // its bumped updatedAt (vs lastReadAt) surfaces the dot.
  const prevRunning = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(running);
    let finished = false;
    for (const id of prevRunning.current) if (!current.has(id)) finished = true;
    prevRunning.current = current;
    if (finished) utils.threads.list.invalidate();
  }, [running, utils]);

  const allThreads = threads ?? [];
  const allProjects = projects ?? [];
  // A pinned thread always floats to the Pinned section as a standalone row, so
  // project / chat lists only ever render their own non-pinned threads.
  const pinnedThreads = allThreads.filter((th) => th.pinned);
  const pinnedProjects = allProjects.filter((p) => p.pinned);
  const openProjects = allProjects.filter((p) => !p.pinned);
  const projectThreads = (projectId: string): ThreadItem[] =>
    allThreads.filter((th) => th.projectId === projectId && !th.pinned);
  const looseThreads = allThreads.filter((th) => th.projectId == null && !th.pinned);
  const hasPinned = pinnedThreads.length > 0 || pinnedProjects.length > 0;

  const renderThread = (thread: ThreadItem): React.JSX.Element => (
    <ThreadRow key={thread.id} thread={thread} running={runningSet.has(thread.id)} />
  );
  const renderProject = (project: ProjectItem): React.JSX.Element => (
    <ProjectRow
      key={project.id}
      project={project}
      expanded={!collapsed.has(project.id)}
      onToggle={() => toggleCollapse(project.id)}
      threads={projectThreads(project.id)}
      renderThread={renderThread}
    />
  );

  return (
    <aside
      className="flex h-full min-h-0 select-none flex-col border-r border-border-default bg-surface"
      style={{ width }}
    >
      <div className="atrium-titlebar" />

      <nav className="flex shrink-0 flex-col gap-0.5 px-3 pt-2 pb-1">
        <Link
          to="/"
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <SquarePen className="size-[15px] shrink-0" />
          <span className="flex-1 text-left">{t('home.newChat')}</span>
        </Link>
        <SbNavItem
          icon={<Search className="size-[15px] shrink-0" />}
          label={t('sidebar.search')}
          onClick={() => openPalette(true)}
        />
      </nav>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading ? (
          <div className="px-3 py-1.5 text-fg-disabled text-sm">{t('common.loading')}</div>
        ) : (
          <>
            {hasPinned && (
              <>
                <SbSection label={t('sidebar.pinned')} />
                <div className="flex flex-col gap-1">
                  {pinnedProjects.map(renderProject)}
                  {pinnedThreads.map(renderThread)}
                </div>
              </>
            )}

            <SbSection
              label={t('sidebar.projects')}
              hoverActions={
                <SbIconButton
                  title={t('sidebar.addProject')}
                  icon={<FolderPlus className="size-[13px]" />}
                  onClick={onAddProject}
                />
              }
            />
            {openProjects.length > 0 && (
              <div className="flex flex-col gap-1">{openProjects.map(renderProject)}</div>
            )}

            <SbSection
              label={t('sidebar.chats')}
              hoverActions={
                <SbIconButton
                  title={t('home.newChat')}
                  icon={<SquarePen className="size-[13px]" />}
                  onClick={() => navigate({ to: '/' })}
                />
              }
            />
            {looseThreads.length === 0 ? (
              <div className="px-3 py-1.5 text-fg-disabled text-sm">{t('sidebar.noChats')}</div>
            ) : (
              <div className="flex flex-col gap-1">{looseThreads.map(renderThread)}</div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border-default px-3 py-2">
        <Link
          to="/settings/$section"
          params={{ section: 'general' }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <Settings className="size-[15px] shrink-0" />
          <span>{t('sidebar.settings')}</span>
        </Link>
      </div>
    </aside>
  );
});
