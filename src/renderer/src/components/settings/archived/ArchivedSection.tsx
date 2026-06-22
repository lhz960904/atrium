import { ArchiveRestore, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../../lib/time';
import { trpc } from '../../../lib/trpc';
import { toast } from '../../../state/toast-store';
import { SnippetText } from '../../SearchSnippet';
import { Tooltip } from '../../Tooltip';

/** Debounce before hitting the FTS query so each keystroke doesn't fire one. */
const SEARCH_DEBOUNCE_MS = 220;

export function ArchivedSection(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  // Same full-text backend as the ⌘K palette, scoped to archived threads.
  const { data, isLoading } = trpc.search.chats.useQuery(
    { query: debounced, scope: 'archived' },
    { keepPreviousData: true },
  );

  const unarchive = trpc.threads.unarchive.useMutation({
    onSuccess: async () => {
      // Restored threads rejoin the sidebar and the active palette scope.
      await Promise.all([utils.search.chats.invalidate(), utils.threads.list.invalidate()]);
      toast.success(t('settings.archived.restored'));
    },
  });
  const remove = trpc.threads.delete.useMutation({
    onSuccess: () => utils.search.chats.invalidate(),
  });

  const onDelete = (id: string): void => {
    if (window.confirm(t('settings.archived.deleteConfirm'))) remove.mutate({ id });
  };

  if (isLoading) return <p className="text-fg-tertiary text-sm">{t('common.loading')}</p>;

  const hits = data?.hits ?? [];
  const searching = debounced.trim() !== '';
  // Hide the search box only when there is genuinely nothing to search.
  const showSearch = searching || hits.length > 0;

  return (
    <section>
      {showSearch && (
        <div className="mb-3 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-[14px] text-fg-tertiary" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('settings.archived.searchPlaceholder')}
              className="w-full rounded-lg border border-border-default bg-surface py-2 pr-3 pl-9 text-fg-primary text-sm placeholder:text-fg-tertiary focus:border-border-strong focus:outline-none"
            />
          </div>
          <span className="shrink-0 text-fg-tertiary text-xs">
            {t('settings.archived.count', { n: hits.length })}
          </span>
        </div>
      )}

      {hits.length === 0 ? (
        <div className="rounded-lg border border-border-default border-dashed bg-surface px-6 py-10 text-center text-fg-tertiary text-sm leading-relaxed">
          {searching ? t('settings.archived.noResults') : t('settings.archived.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {hits.map((hit) => (
            <div
              key={hit.threadId}
              className="group flex items-center gap-3 rounded-lg border border-border-default bg-surface px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-fg-primary text-sm">
                  {hit.matchedIn === 'title' && hit.snippet ? (
                    <SnippetText snippet={hit.snippet} />
                  ) : (
                    (hit.title ?? t('common.untitledChat'))
                  )}
                </span>
                {hit.matchedIn === 'message' && hit.snippet && (
                  <span className="truncate text-fg-tertiary text-xs">
                    <SnippetText snippet={hit.snippet} />
                  </span>
                )}
                {hit.archivedAt != null && (
                  <span className="text-fg-tertiary text-xs">
                    {formatDateTime(hit.archivedAt, i18n.language)}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                <Tooltip content={t('settings.archived.restore')}>
                  <button
                    type="button"
                    aria-label={t('settings.archived.restore')}
                    onClick={() => unarchive.mutate({ id: hit.threadId })}
                    className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-primary"
                  >
                    <ArchiveRestore className="size-[14px]" />
                  </button>
                </Tooltip>
                <Tooltip content={t('common.delete')}>
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() => onDelete(hit.threadId)}
                    className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-danger"
                  >
                    <Trash2 className="size-[14px]" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
