import * as Dialog from '@radix-ui/react-dialog';
import { CUSTOM_MODEL_APIS, type CustomModelApi, type CustomProvider } from '@shared/custom-model';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

const input =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-fg-primary text-sm outline-0 focus:border-accent';
const label = 'mb-1 block font-medium text-fg-secondary text-xs';

/**
 * Define a provider Atrium doesn't ship, or edit one. The id is fixed once
 * created: it keys the stored credential and is written into every thread that
 * runs on it, so renaming it would orphan both.
 */
export function CustomProviderDialog({
  editing,
  onClose,
  onCreated,
}: {
  /** The provider being edited with its id, or 'new'. */
  editing: ({ id: string } & CustomProvider) | 'new';
  onClose: () => void;
  onCreated?: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const existing = editing === 'new' ? null : editing;

  const [id, setId] = useState(existing?.id ?? '');
  const [draft, setDraft] = useState<CustomProvider>(
    existing ?? { name: '', baseUrl: '', api: 'openai-completions' },
  );

  const done = (): void => {
    utils.providers.list.invalidate();
    onClose();
  };
  const create = trpc.providers.createCustomProvider.useMutation({
    onSuccess: () => {
      onCreated?.(id);
      done();
    },
  });
  const update = trpc.providers.updateCustomProvider.useMutation({ onSuccess: done });
  const pending = create.isLoading || update.isLoading;
  const error = create.error ?? update.error;

  const idOk = /^[a-z0-9][a-z0-9-]*$/.test(id);
  const valid = idOk && draft.name.trim().length > 0 && /^https?:\/\//.test(draft.baseUrl.trim());

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[85vh] w-[min(520px,92vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none"
        >
          <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
              {existing
                ? t('settings.providers.customProvider.edit', { name: existing.name })
                : t('settings.providers.customProvider.add')}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
              title={t('common.close')}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div>
              <span className={label}>{t('settings.providers.customProvider.id')}</span>
              <input
                className={`${input} font-mono disabled:opacity-60`}
                value={id}
                disabled={existing !== null}
                placeholder="my-relay"
                onChange={(e) => setId(e.target.value.toLowerCase().trim())}
              />
              <p className="mt-1 text-[11px] text-fg-tertiary">
                {existing
                  ? t('settings.providers.customProvider.idFixed')
                  : t('settings.providers.customProvider.idHint')}
              </p>
            </div>

            <div className="mt-3">
              <span className={label}>{t('settings.providers.customProvider.name')}</span>
              <input
                className={input}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="mt-3">
              <span className={label}>{t('settings.providers.customProvider.baseUrl')}</span>
              <input
                className={`${input} font-mono`}
                value={draft.baseUrl}
                placeholder="https://example.com/v1"
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value.trim() })}
              />
            </div>

            <div className="mt-3">
              <span className={label}>{t('settings.providers.custom.api')}</span>
              <select
                className={input}
                value={draft.api}
                onChange={(e) => setDraft({ ...draft, api: e.target.value as CustomModelApi })}
              >
                {CUSTOM_MODEL_APIS.map((api) => (
                  <option key={api} value={api}>
                    {api}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-fg-tertiary">
                {t('settings.providers.customProvider.afterHint')}
              </p>
            </div>

            {error && <p className="mt-3 break-words text-danger text-xs">{error.message}</p>}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-border-default border-t px-4 py-2.5">
            <Dialog.Close className="rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong">
              {t('common.cancel')}
            </Dialog.Close>
            <button
              type="button"
              disabled={!valid || pending}
              onClick={() =>
                existing
                  ? update.mutate({ id: existing.id, provider: draft })
                  : create.mutate({ id, provider: draft })
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
