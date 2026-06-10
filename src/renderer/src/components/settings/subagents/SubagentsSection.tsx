import { Bot, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { deriveGroups } from '../../../lib/use-chat-model';
import { SubagentForm, type SubagentItem } from './SubagentForm';

/** `new` is the create-a-subagent pseudo-selection. */
type Selection = string | 'new' | null;

export function SubagentsSection(): React.JSX.Element {
  const { t } = useTranslation();
  const subagents = trpc.subagents.list.useQuery();
  const tools = trpc.subagents.assignableTools.useQuery();
  const providers = trpc.providers.list.useQuery();
  const utils = trpc.useUtils();
  const del = trpc.subagents.delete.useMutation({
    onSuccess: () => {
      utils.subagents.list.invalidate();
      setSelected(null);
    },
  });

  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState(false);

  const select = (s: Selection): void => {
    setSelected(s);
    setEditing(false);
  };

  if (subagents.isLoading || !subagents.data) {
    return <p className="text-fg-tertiary text-sm">{t('common.loading')}</p>;
  }

  const list = subagents.data;
  const groups = deriveGroups(providers.data ?? []);
  const current =
    selected === 'new' ? 'new' : (list.find((s) => s.id === selected) ?? list[0] ?? null);

  return (
    <div className="grid h-full grid-cols-[260px_1fr] overflow-hidden rounded-xl border border-border-default bg-canvas">
      <aside className="flex min-h-0 flex-col border-border-default border-r bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {list.map((s) => (
            <SubagentRow
              key={s.id}
              item={s}
              active={current !== 'new' && current?.id === s.id}
              onSelect={() => select(s.id)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSelected('new')}
          className={`flex items-center gap-2 border-border-default border-t px-3 py-2.5 text-left text-sm ${
            current === 'new'
              ? 'bg-surface-strong text-fg-primary'
              : 'text-fg-secondary hover:bg-elevated'
          }`}
        >
          <Plus className="size-4 shrink-0 text-fg-tertiary" />
          {t('settings.subagents.newSubagent')}
        </button>
      </aside>

      <section className="min-h-0 overflow-hidden">
        {current === 'new' ? (
          <SubagentForm
            subagent={null}
            groups={groups}
            assignableTools={tools.data ?? []}
            onDone={(id) => select(id)}
            onCancel={() => setSelected(null)}
          />
        ) : current && !current.builtin && editing ? (
          <SubagentForm
            key={current.id}
            subagent={current}
            groups={groups}
            assignableTools={tools.data ?? []}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : current ? (
          <SubagentReadonly
            item={current}
            onEdit={current.builtin ? undefined : () => setEditing(true)}
            onDelete={current.builtin ? undefined : () => del.mutate({ id: current.id })}
          />
        ) : (
          <Empty />
        )}
      </section>
    </div>
  );
}

function SubagentRow({
  item,
  active,
  onSelect,
}: {
  item: SubagentItem;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
        active ? 'bg-surface-strong text-fg-primary' : 'text-fg-secondary hover:bg-elevated'
      }`}
    >
      <Bot className="size-4 shrink-0 text-fg-tertiary" />
      <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
      {item.builtin && <Lock className="size-3 shrink-0 text-fg-disabled" />}
    </button>
  );
}

/** Read-only view of a subagent. Built-ins can't be edited; custom ones get
 *  Edit / Delete actions. */
function SubagentReadonly({
  item,
  onEdit,
  onDelete,
}: {
  item: SubagentItem;
  onEdit?: () => void;
  onDelete?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-fg-primary text-lg">{item.name}</h2>
        {item.builtin && (
          <span className="rounded-full bg-surface-strong px-2 py-0.5 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
            {t('settings.subagents.builtin')}
          </span>
        )}
        <span className="flex-1" />
        {onEdit && (
          <>
            <button
              type="button"
              title={t('common.edit')}
              onClick={onEdit}
              className="rounded-md p-1.5 text-fg-tertiary hover:bg-elevated hover:text-fg-secondary"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              title={t('common.delete')}
              onClick={onDelete}
              className="rounded-md p-1.5 text-fg-tertiary hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        )}
      </div>
      <p className="text-fg-secondary text-sm">{item.description}</p>
      <div>
        <span className="mb-1 block font-medium text-fg-secondary text-xs">
          {t('settings.subagents.systemPrompt')}
        </span>
        <pre className="whitespace-pre-wrap rounded-lg border border-border-default bg-surface p-3 font-mono text-fg-secondary text-xs">
          {item.systemPrompt}
        </pre>
      </div>
      <div>
        <span className="mb-1 block font-medium text-fg-secondary text-xs">
          {t('settings.subagents.availableTools')}
        </span>
        {item.toolAllow ? (
          <div className="flex flex-wrap gap-1.5">
            {item.toolAllow.map((t) => (
              <span
                key={t}
                className="rounded-md border border-border-default px-2 py-0.5 text-fg-tertiary text-xs"
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-fg-tertiary text-sm">{t('settings.subagents.inheritTools')}</span>
        )}
      </div>
      <div>
        <span className="mb-1 block font-medium text-fg-secondary text-xs">
          {t('settings.subagents.handoffModel')}
        </span>
        {item.providerId && item.modelId ? (
          <span className="text-fg-secondary text-sm">{`${item.providerId} · ${item.modelId}`}</span>
        ) : (
          <span className="text-fg-tertiary text-sm">{t('settings.subagents.inheritModel')}</span>
        )}
      </div>
    </div>
  );
}

function Empty(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center px-6 text-fg-tertiary text-sm">
      {t('settings.subagents.emptyHint')}
    </div>
  );
}
