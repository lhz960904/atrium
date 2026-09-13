import * as Dialog from '@radix-ui/react-dialog';
import {
  CUSTOM_MODEL_APIS,
  type CustomModel,
  type CustomModelApi,
  DEFAULT_CUSTOM_MODEL,
} from '@shared/custom-model';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

const input =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-fg-primary text-sm outline-0 focus:border-accent';
const label = 'mb-1 block font-medium text-fg-secondary text-xs';

/** Per-million-token rates, which is how every vendor publishes them. */
const RATE_FIELDS = [
  ['input', 'settings.providers.custom.costInput'],
  ['output', 'settings.providers.custom.costOutput'],
  ['cacheRead', 'settings.providers.custom.costCacheRead'],
  ['cacheWrite', 'settings.providers.custom.costCacheWrite'],
] as const;

/**
 * Add or correct one model on a provider. The fields are the engine's own
 * model record, so what the user types is what a turn runs with: the window
 * feeds compaction and the rates feed the ledger.
 */
export function CustomModelDialog({
  providerId,
  editing,
  onClose,
}: {
  providerId: string;
  /** The model being edited, or 'new'. null keeps the dialog closed. */
  editing: CustomModel | 'new' | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const existing = editing === 'new' || editing === null ? null : editing;
  const upsert = trpc.providers.upsertCustomModel.useMutation({
    onSuccess: () => {
      utils.providers.list.invalidate();
      onClose();
    },
  });

  // Keyed on the model being edited so reopening starts from its values.
  const [draft, setDraft] = useState<CustomModel>(
    existing ?? { id: '', name: '', ...DEFAULT_CUSTOM_MODEL },
  );
  const patch = (next: Partial<CustomModel>): void => setDraft((d) => ({ ...d, ...next }));

  const valid = draft.id.trim().length > 0 && draft.contextWindow > 0 && draft.maxTokens > 0;

  return (
    <Dialog.Root open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[85vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none"
        >
          <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
              {existing
                ? t('settings.providers.custom.edit', { id: existing.id })
                : t('settings.providers.custom.add')}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
              title={t('common.close')}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={label}>{t('settings.providers.custom.id')}</span>
                <input
                  className={`${input} font-mono`}
                  value={draft.id}
                  placeholder={t('settings.providers.custom.idHint')}
                  onChange={(e) => patch({ id: e.target.value.trim() })}
                />
              </div>
              <div>
                <span className={label}>{t('settings.providers.custom.name')}</span>
                <input
                  className={input}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-3">
              <span className={label}>{t('settings.providers.custom.api')}</span>
              <select
                className={input}
                value={draft.api}
                onChange={(e) => patch({ api: e.target.value as CustomModelApi })}
              >
                {CUSTOM_MODEL_APIS.map((api) => (
                  <option key={api} value={api}>
                    {api}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <span className={label}>{t('settings.providers.custom.contextWindow')}</span>
                <input
                  className={input}
                  type="number"
                  min={1}
                  value={draft.contextWindow}
                  onChange={(e) => patch({ contextWindow: Number(e.target.value) })}
                />
                <p className="mt-1 text-[11px] text-fg-tertiary">
                  {t('settings.providers.custom.contextWindowHint')}
                </p>
              </div>
              <div>
                <span className={label}>{t('settings.providers.custom.maxTokens')}</span>
                <input
                  className={input}
                  type="number"
                  min={1}
                  value={draft.maxTokens}
                  onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="mt-3 flex gap-5">
              <label className="flex items-center gap-2 text-fg-secondary text-sm">
                <input
                  type="checkbox"
                  checked={draft.input.includes('image')}
                  onChange={(e) =>
                    patch({ input: e.target.checked ? ['text', 'image'] : ['text'] })
                  }
                />
                {t('settings.providers.custom.vision')}
              </label>
              <label className="flex items-center gap-2 text-fg-secondary text-sm">
                <input
                  type="checkbox"
                  checked={draft.reasoning}
                  onChange={(e) => patch({ reasoning: e.target.checked })}
                />
                {t('settings.providers.custom.reasoning')}
              </label>
            </div>

            <div className="mt-4">
              <span className={label}>{t('settings.providers.custom.cost')}</span>
              <div className="grid grid-cols-4 gap-2">
                {RATE_FIELDS.map(([key, labelKey]) => (
                  <div key={key}>
                    <span className="mb-1 block text-[11px] text-fg-tertiary">{t(labelKey)}</span>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.cost[key]}
                      onChange={(e) =>
                        patch({ cost: { ...draft.cost, [key]: Number(e.target.value) } })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            {upsert.error && (
              <p className="mt-3 break-words text-danger text-xs">{upsert.error.message}</p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-border-default border-t px-4 py-2.5">
            <Dialog.Close className="rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong">
              {t('common.cancel')}
            </Dialog.Close>
            <button
              type="button"
              disabled={!valid || upsert.isLoading}
              onClick={() =>
                upsert.mutate({
                  id: providerId,
                  model: { ...draft, name: draft.name.trim() || draft.id },
                  previousId: existing?.id,
                })
              }
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
