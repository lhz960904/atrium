import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarClock, FolderPlus, Search, Settings, SquarePen } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dropThreadChat } from '../../lib/chat-store';
import { trpc } from '../../lib/trpc';
import { useCommandPalette } from '../../state/command-palette-store';
import { useUpdateStore } from '../../state/update-store';
import { ProjectRow } from './ProjectRow';
import { SbIconButton, SbNavItem, SbSection } from './primitives';
import { ThreadRow } from './ThreadRow';
import type { ProjectItem, ThreadItem } from './types';

// Stable empty list so a project with no threads keeps a referentially-constant
// `threads` prop across renders, letting the memoized ProjectRow bail out.
const EMPTY_THREADS: ThreadItem[] = [];

export const Sidebar = memo(function Sidebar(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const updateStage = useUpdateStore((s) => s.state.stage);
  const openUpdateDialog = useUpdateStore((s) => s.openDialog);
  const showUpdate =
    updateStage === 'available' || updateStage === 'downloading' || updateStage === 'downloaded';
  const utils = trpc.useUtils();
  const { data: threads, isLoading } = trpc.threads.list.useQuery();
  const { data: projects } = trpc.projects.list.useQuery();
  // Poll the main process for which threads are generating; a small id list, so
  // the interval is cheap (unlike polling message content).
  const { data: running } = trpc.threads.running.useQuery(undefined, { refetchInterval: 2000 });
  // React Query keeps `running` referentially stable across polls when the set
  // is unchanged (structural sharing), so this Set — and every row prop derived
  // from it — stays stable and the memoized rows don't re-render every 2s.
  const runningSet = useMemo(() => new Set(running), [running]);
  // Threads bound to a scheduled task get a hover clock badge. The binding lives
  // on the task (scheduledTasks.threadId), so derive the set from the task list.
  const { data: scheduled } = trpc.scheduled.list.useQuery();
  const scheduledThreadIds = useMemo(
    () => new Set((scheduled ?? []).map((task) => task.threadId).filter(Boolean)),
    [scheduled],
  );

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
  const toggleCollapse = useCallback(
    (id: string): void =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  // A background run (a scheduled task) has no client mounted to refresh views
  // when it starts or finishes. Watch the polled running set: for every thread
  // whose running state flips, drop its cached Chat and invalidate its messages
  // query so the next open re-seeds fresh (with the run's appended turn) and
  // resumes the live stream — otherwise the stale in-memory Chat shows nothing
  // until a full reload. Also refetch the list so the unread dot surfaces.
  const prevRunning = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(running);
    const prev = prevRunning.current;
    const flipped = [
      ...[...current].filter((id) => !prev.has(id)),
      ...[...prev].filter((id) => !current.has(id)),
    ];
    prevRunning.current = current;
    if (flipped.length === 0) return;
    for (const id of flipped) {
      dropThreadChat(id);
      utils.threads.get.invalidate({ id });
    }
    utils.threads.list.invalidate();
  }, [running, utils]);

  // Bucket threads once per data change instead of re-filtering the whole list
  // per project on every render. A pinned thread always floats to the Pinned
  // section as a standalone row, so project / chat lists only ever render their
  // own non-pinned threads.
  const { pinnedThreads, pinnedProjects, openProjects, looseThreads, threadsByProject } =
    useMemo(() => {
      const allThreads = threads ?? [];
      const allProjects = projects ?? [];
      const byProject = new Map<string, ThreadItem[]>();
      const loose: ThreadItem[] = [];
      for (const th of allThreads) {
        if (th.pinned) continue;
        if (th.projectId == null) loose.push(th);
        else {
          const bucket = byProject.get(th.projectId);
          if (bucket) bucket.push(th);
          else byProject.set(th.projectId, [th]);
        }
      }
      return {
        pinnedThreads: allThreads.filter((th) => th.pinned),
        pinnedProjects: allProjects.filter((p) => p.pinned),
        openProjects: allProjects.filter((p) => !p.pinned),
        looseThreads: loose,
        threadsByProject: byProject,
      };
    }, [threads, projects]);
  const hasPinned = pinnedThreads.length > 0 || pinnedProjects.length > 0;

  const renderThread = useCallback(
    (thread: ThreadItem): React.JSX.Element => (
      <ThreadRow
        key={thread.id}
        thread={thread}
        running={runningSet.has(thread.id)}
        hasSchedule={scheduledThreadIds.has(thread.id)}
      />
    ),
    [runningSet, scheduledThreadIds],
  );
  const renderProject = useCallback(
    (project: ProjectItem): React.JSX.Element => (
      <ProjectRow
        key={project.id}
        project={project}
        expanded={!collapsed.has(project.id)}
        onToggle={toggleCollapse}
        threads={threadsByProject.get(project.id) ?? EMPTY_THREADS}
        renderThread={renderThread}
      />
    ),
    [collapsed, toggleCollapse, threadsByProject, renderThread],
  );

  return (
    <aside
      className="flex h-full min-h-0 select-none flex-col border-r border-border-default bg-surface"
      // Width comes from AppLayout via the --sidebar-width CSS variable so a
      // resize drag (which updates it every frame) repaints without re-rendering
      // the whole sidebar tree. Kept explicit — not 100% — so collapsing (grid
      // column → 0) clips the sidebar instead of reflowing its contents.
      style={{ width: 'var(--sidebar-width, 260px)' }}
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
        <Link
          to="/scheduled"
          className="group flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
          activeProps={{
            className:
              'group flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-sm bg-elevated text-fg-primary [&_svg]:text-accent',
          }}
        >
          <CalendarClock className="size-[15px] shrink-0" />
          <span className="flex-1 text-left">{t('scheduled.title')}</span>
        </Link>
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

      <div className="shrink-0 border-border-default border-t px-3 py-2">
        <Link
          to="/settings/$section"
          params={{ section: 'general' }}
          className="flex items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <Settings className="size-[15px] shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('sidebar.settings')}</span>
          {showUpdate && (
            <button
              type="button"
              // The badge lives inside the Settings link; stop the click so it
              // opens the update dialog instead of navigating to Settings.
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openUpdateDialog();
              }}
              className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent text-xs hover:bg-accent/20"
            >
              {t('update.entry')}
            </button>
          )}
        </Link>
      </div>
    </aside>
  );
});
