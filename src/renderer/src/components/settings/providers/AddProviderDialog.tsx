import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { ProviderIcon } from './ProviderIcon';
import { providerLabel } from './provider-label';

/**
 * Pick a provider to add. Only the ones not added yet are listed, and adding is
 * the whole step — the provider is on from that point, so there is no second
 * switch to forget.
 */
export function AddProviderDialog({
  onClose,
  onAdded,
  onDefineCustom,
}: {
  onClose: () => void;
  onAdded: (id: string) => void;
  onDefineCustom: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const available = trpc.providers.available.useQuery();
  const add = trpc.providers.add.useMutation({
    onSuccess: (_data, { id }) => {
      utils.providers.list.invalidate();
      utils.providers.available.invalidate();
      onAdded(id);
      onClose();
    },
  });

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[80vh] w-[min(520px,92vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none"
        >
          <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
              {t('settings.providers.addProvider')}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
              title={t('common.close')}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {(available.data ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={add.isLoading}
                onClick={() => add.mutate({ id: p.id })}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-strong disabled:opacity-50"
              >
                <ProviderIcon id={p.id} className="size-4 shrink-0 text-fg-primary" />
                <span className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
                  {providerLabel(t, p.id, p.name)}
                </span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                onClose();
                onDefineCustom();
              }}
              className="mt-1 flex w-full items-center gap-3 rounded-lg border border-border-default border-dashed px-3 py-2.5 text-left hover:bg-surface-strong"
            >
              <Plus className="size-4 shrink-0 text-fg-tertiary" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg-primary text-sm">
                  {t('settings.providers.customProvider.add')}
                </span>
                <span className="block truncate text-fg-tertiary text-xs">
                  {t('settings.providers.customProvider.addHint')}
                </span>
              </span>
            </button>

            {add.error && (
              <p className="px-3 py-2 break-words text-danger text-xs">{add.error.message}</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
