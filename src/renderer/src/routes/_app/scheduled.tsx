import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDetail } from '../../components/scheduled/TaskDetail';
import { TaskRow } from '../../components/scheduled/TaskRow';
import type { ScheduledTask } from '../../lib/schedule-format';
import { trpc } from '../../lib/trpc';

/** Width of the detail panel that slides in from the right. */
const DETAIL_WIDTH = 540;

function ScheduledView(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'zh' = i18n.language.startsWith('zh') ? 'zh' : 'en';
  // Poll so next-run advances and a completed run's status surfaces without a
  // manual refresh (a background run has no client mounted to invalidate).
  const list = trpc.scheduled.list.useQuery(undefined, { refetchInterval: 5000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const tasks = list.data ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q ? tasks.filter((tk) => tk.title.toLowerCase().includes(q)) : tasks;
  // Detail is a layout panel opened on selection; the list shows by default.
  const current = selectedId ? (tasks.find((tk) => tk.id === selectedId) ?? null) : null;
  // Keep the last-shown task mounted while the panel animates closed, so its
  // content slides out with the panel instead of vanishing first.
  const lastTask = useRef<ScheduledTask | null>(null);
  if (current) lastTask.current = current;
  const panelTask = current ?? lastTask.current;
  const close = (): void => setSelectedId(null);

  return (
    <div
      className="grid h-full"
      style={{
        gridTemplateColumns: `1fr ${current ? DETAIL_WIDTH : 0}px`,
        transition: 'grid-template-columns 200ms ease-out',
      }}
    >
      <div className="min-w-0 overflow-hidden">
        <div className="mx-auto flex h-full max-w-[760px] flex-col px-6">
          <div className="app-drag h-9 shrink-0" />
          <header className="shrink-0 pb-3">
            <h1 className="font-semibold text-2xl text-fg-primary tracking-tight">
              {t('scheduled.title')}
            </h1>
            <p className="mt-1 text-fg-tertiary text-sm">{t('scheduled.subtitle')}</p>
            <div className="relative mt-4">
              <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-fg-tertiary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('scheduled.searchPlaceholder')}
                className="w-full rounded-md border border-border-default bg-surface py-1.5 pr-2 pl-8 text-fg-primary text-sm placeholder:text-fg-disabled focus:border-accent focus:outline-none"
              />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            {tasks.length === 0 ? (
              <p className="px-3 py-10 text-center text-fg-tertiary text-sm">
                {t('scheduled.empty')}
              </p>
            ) : (
              <>
                <div className="px-3 pt-2 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
                  {t('scheduled.current')}
                </div>
                {filtered.map((tk) => (
                  <TaskRow key={tk.id} task={tk} lang={lang} onOpen={() => setSelectedId(tk.id)} />
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Layout panel (not an overlay): the list shrinks as this slides in. The
          inner fixed width keeps the content from reflowing during the animation. */}
      <div className="min-w-0 overflow-hidden border-border-default border-l bg-canvas">
        {panelTask && (
          <div className="h-full" style={{ width: DETAIL_WIDTH }}>
            <TaskDetail
              key={panelTask.id}
              task={panelTask}
              lang={lang}
              onClose={close}
              onDeleted={close}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/scheduled')({
  component: ScheduledView,
});
