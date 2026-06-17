import { ChevronRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

// Stored types render in this order; anything unknown falls to the end, alphabetical.
const TYPE_ORDER = ['preference', 'project', 'reference'];
const typeRank = (type: string): number => {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? TYPE_ORDER.length : i;
};

export function MemoriesSection(): React.JSX.Element {
  const { t } = useTranslation();
  const [scope, setScope] = useState<string>('global');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();
  const projects = trpc.memory.projects.useQuery();
  const list = trpc.memory.list.useQuery({ scope });
  const entries = list.data ?? [];

  // Global first, then every project that has stored memory, labelled by name.
  const tabs = [
    { key: 'global', name: t('settings.memories.scopeGlobal') },
    ...(projects.data ?? []),
  ];

  const remove = trpc.memory.delete.useMutation({
    onSuccess: () => utils.memory.list.invalidate({ scope }),
  });

  const toggle = (name: string): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const onDelete = (name: string): void => {
    if (window.confirm(t('settings.memories.deleteConfirm'))) {
      remove.mutate({ scope, name });
    }
  };

  const groups = [...new Set(entries.map((e) => e.type))].sort(
    (a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b),
  );

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setScope(tab.key)}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                scope === tab.key
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border-default bg-surface text-fg-tertiary hover:border-border-strong hover:text-fg-secondary'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
        {entries.length > 0 && (
          <span className="shrink-0 text-fg-tertiary text-xs">
            {t('settings.memories.count', { n: entries.length })}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-border-default border-dashed bg-surface px-6 py-10 text-center text-fg-tertiary text-sm leading-relaxed">
          {t('settings.memories.empty')}
        </div>
      ) : (
        groups.map((type) => (
          <div key={type} className="mb-6">
            <h2 className="mb-2 font-medium text-fg-tertiary text-xs uppercase tracking-wide">
              {type}
            </h2>
            <div className="flex flex-col gap-1.5">
              {entries
                .filter((e) => e.type === type)
                .map((e) => {
                  const isOpen = open.has(e.name);
                  return (
                    <div
                      key={e.name}
                      className="overflow-hidden rounded-lg border border-border-default bg-surface"
                    >
                      <div className="group flex items-center gap-2.5 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggle(e.name)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <ChevronRight
                            className={`size-3.5 shrink-0 text-fg-tertiary transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                          <span className="shrink-0 font-medium text-fg-primary text-sm">
                            {e.name}
                          </span>
                          <span className="min-w-0 truncate text-fg-tertiary text-xs">
                            {e.description}
                          </span>
                        </button>
                        <button
                          type="button"
                          title={t('common.delete')}
                          onClick={() => onDelete(e.name)}
                          className="shrink-0 rounded-md p-1.5 text-fg-tertiary opacity-0 hover:bg-surface-strong hover:text-danger focus:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="size-[14px]" />
                        </button>
                      </div>
                      {isOpen && (
                        <pre className="whitespace-pre-wrap border-border-default border-t bg-canvas px-4 py-3 font-mono text-fg-secondary text-xs leading-relaxed">
                          {e.content}
                        </pre>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
