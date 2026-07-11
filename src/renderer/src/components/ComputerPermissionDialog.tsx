import * as Dialog from '@radix-ui/react-dialog';
import { COMPUTER_USE_NEEDS_PERMISSION_CHANNEL } from '@shared/computer-use';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../lib/trpc';
import { AuthGuide } from './settings/computer/AuthGuide';

/**
 * Runtime grant prompt: the main process fires the needs-permission channel when
 * a computer tool runs without both grants. It reuses the same <AuthGuide> as the
 * settings page, polls while open, and closes itself once both land.
 */
export function ComputerPermissionDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const perms = trpc.computer.permissions.useQuery(undefined, {
    refetchInterval: open ? 2000 : false,
  });

  useEffect(() => {
    return window.electron?.ipcRenderer.on(COMPUTER_USE_NEEDS_PERMISSION_CHANNEL, () => {
      setOpen(true);
    });
  }, []);

  const accessibility = perms.data?.accessibility ?? false;
  const screenRecording = perms.data?.screenRecording ?? false;

  useEffect(() => {
    if (open && accessibility && screenRecording) setOpen(false);
  }, [open, accessibility, screenRecording]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex w-[min(520px,92vw)] flex-col gap-5 rounded-xl border border-border-default bg-elevated p-6 shadow-xl outline-none"
        >
          <div className="flex flex-col gap-1.5">
            <Dialog.Title className="font-semibold text-fg-primary text-lg">
              {t('settings.computer.runtimeTitle')}
            </Dialog.Title>
            <p className="text-fg-tertiary text-sm">{t('settings.computer.runtimeDesc')}</p>
          </div>
          <AuthGuide accessibility={accessibility} screenRecording={screenRecording} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
            >
              {t('settings.computer.runtimeLater')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
