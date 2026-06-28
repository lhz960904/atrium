import * as Dialog from '@radix-ui/react-dialog';
import { Pencil, Plus, Server, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { McpForm, type McpServerItem } from './McpForm';

/** What the form dialog is editing: a server, `new`, or closed. */
type Editing = McpServerItem | 'new' | null;

export function McpSection(): React.JSX.Element {
  const { t } = useTranslation();
  const servers = trpc.mcp.list.useQuery();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<Editing>(null);

  const setEnabled = trpc.mcp.setEnabled.useMutation({
    onSuccess: () => utils.mcp.list.invalidate(),
  });
  const del = trpc.mcp.delete.useMutation({ onSuccess: () => utils.mcp.list.invalidate() });

  if (servers.isLoading || !servers.data) {
    return <p className="text-fg-tertiary text-sm">{t('common.loading')}</p>;
  }

  const list = servers.data;

  return (
    <div className="mx-auto flex h-full w-full max-w-[820px] flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-fg-tertiary text-sm">
          {t('settings.mcp.count', { count: list.length })}
        </span>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-fg-on-accent text-sm hover:bg-accent-hover"
        >
          <Plus className="size-4" />
          {t('settings.mcp.addServer')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <Empty onAdd={() => setEditing('new')} />
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((s) => (
              <Row
                key={s.id}
                item={s}
                onEdit={() => setEditing(s)}
                onToggle={(enabled) => setEnabled.mutate({ id: s.id, enabled })}
                onDelete={() => del.mutate({ id: s.id })}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog.Root open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby={undefined}
            className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[85vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none"
          >
            <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-4 py-2.5">
              <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
                {editing === 'new'
                  ? t('settings.mcp.addServer')
                  : t('settings.mcp.editServer', { name: editing?.name ?? '' })}
              </Dialog.Title>
              <Dialog.Close
                className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
                title={t('common.close')}
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {editing !== null && (
                <McpForm
                  server={editing === 'new' ? null : editing}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Row({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: McpServerItem;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const subtitle =
    item.transport === 'stdio'
      ? String(item.config?.command ?? '')
      : String(item.config?.url ?? '');
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border-default bg-surface px-4 py-3">
      <input
        type="checkbox"
        checked={item.enabled}
        onChange={(e) => onToggle(e.target.checked)}
        title={t('settings.mcp.enabled')}
        className="shrink-0"
      />
      <Server className="size-4 shrink-0 text-fg-tertiary" />
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="flex max-w-full items-center gap-2">
          <span className="truncate font-medium text-fg-primary text-sm">{item.name}</span>
          <span className="shrink-0 rounded bg-surface-strong px-1.5 py-0.5 text-[10px] text-fg-tertiary uppercase">
            {item.transport}
          </span>
        </span>
        {subtitle && (
          <span className="mt-0.5 max-w-full truncate font-mono text-fg-tertiary text-xs">
            {subtitle}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onEdit}
        title={t('common.edit')}
        className="shrink-0 rounded-md p-1.5 text-fg-tertiary opacity-0 hover:bg-elevated hover:text-fg-secondary group-hover:opacity-100"
      >
        <Pencil className="size-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title={t('common.delete')}
        className="shrink-0 rounded-md p-1.5 text-fg-tertiary opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function Empty({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Server className="size-8 text-fg-disabled" />
      <p className="text-fg-tertiary text-sm">{t('settings.mcp.emptyList')}</p>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-fg-on-accent text-sm hover:bg-accent-hover"
      >
        <Plus className="size-4" />
        {t('settings.mcp.addServer')}
      </button>
    </div>
  );
}
