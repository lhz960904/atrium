import { Clock, MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { useSetting } from '../../../lib/use-setting';
import { EnableSwitch } from '../providers/EnableSwitch';
import { AuthGuide } from './AuthGuide';

function ComingSoon(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[620px] text-fg-tertiary text-sm">{t('settings.computer.lede')}</p>
      <div className="flex items-center gap-3.5 rounded-xl border border-border-default bg-surface px-4 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-fg-secondary">
          <Clock className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-fg-primary text-sm">
            {t('settings.computer.comingSoon')}
          </div>
          <div className="mt-0.5 text-fg-tertiary text-xs">
            {t('settings.computer.comingSoonDesc')}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComputerUseSection(): React.JSX.Element {
  const { t } = useTranslation();
  const perms = trpc.computer.permissions.useQuery(undefined, { refetchInterval: 2000 });
  const { value: enabled, set: setEnabled } = useSetting('computerUse.enabled');
  const { value: showCursor, set: setShowCursor } = useSetting('computerUse.showVirtualCursor');

  // Off macOS the feature can't run; show a coming-soon note instead of controls.
  if (perms.data && !perms.data.supported) {
    return <ComingSoon />;
  }

  const accessibility = perms.data?.accessibility ?? false;
  const screenRecording = perms.data?.screenRecording ?? false;

  return (
    <div className="flex flex-col gap-7">
      <p className="max-w-[620px] text-fg-tertiary text-sm">{t('settings.computer.lede')}</p>

      <div className="rounded-xl border border-border-default bg-surface">
        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
          <div className="min-w-0">
            <div className="font-medium text-fg-primary text-sm">
              {t('settings.computer.enable')}
            </div>
            <div className="mt-0.5 text-fg-tertiary text-xs">
              {t('settings.computer.enableDesc')}
            </div>
          </div>
          <EnableSwitch on={enabled} onToggle={() => setEnabled(!enabled)} />
        </div>
      </div>

      {enabled && (
        <>
          <AuthGuide accessibility={accessibility} screenRecording={screenRecording} />

          <section>
            <h2 className="mb-3 font-semibold text-fg-primary text-sm">
              {t('settings.computer.behaviorTitle')}
            </h2>
            <div className="rounded-xl border border-border-default bg-surface">
              <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-fg-primary text-sm">
                    <MousePointerClick className="size-3.5 text-fg-tertiary" />
                    {t('settings.computer.showCursor')}
                  </div>
                  <div className="mt-0.5 text-fg-tertiary text-xs">
                    {t('settings.computer.showCursorDesc')}
                  </div>
                </div>
                <EnableSwitch on={showCursor} onToggle={() => setShowCursor(!showCursor)} />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
