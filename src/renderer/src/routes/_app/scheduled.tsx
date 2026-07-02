import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDetail } from '../../components/scheduled/TaskDetail';
import { TaskRow } from '../../components/scheduled/TaskRow';
import { trpc } from '../../lib/trpc';

export const Route = createFileRoute('/_app/scheduled')({
  component: ScheduledView,
});

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
  // The detail is a drawer, opened only on selection — the list shows by default.
  const current = selectedId ? (tasks.find((tk) => tk.id === selectedId) ?? null) : null;
  const close = (): void => setSelectedId(null);

  return (
    <div className="relative h-full overflow-hidden">
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

      {/* Detail drawer: dim the list and slide in from the right on selection. */}
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={close}
        className={`absolute inset-0 bg-black/20 transition-opacity duration-200 ${
          current ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`absolute inset-y-0 right-0 w-[460px] max-w-[85%] border-border-default border-l bg-canvas shadow-2xl transition-transform duration-200 ${
          current ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {current && (
          <TaskDetail
            key={current.id}
            task={current}
            lang={lang}
            onClose={close}
            onDeleted={close}
          />
        )}
      </aside>
    </div>
  );
}
