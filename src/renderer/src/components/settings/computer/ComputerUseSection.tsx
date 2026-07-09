import { Accessibility, Check, Clock, Info, MousePointerClick, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { useSetting } from '../../../lib/use-setting';
import { EnableSwitch } from '../providers/EnableSwitch';

type PillTone = 'ok' | 'warn';
const PILL_TONE: Record<PillTone, string> = {
  ok: 'bg-success/12 text-success',
  warn: 'bg-warning/14 text-warning',
};
const DOT_TONE: Record<PillTone, string> = { ok: 'bg-success', warn: 'bg-warning' };

function Pill({ tone, label }: { tone: PillTone; label: string }): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs ${PILL_TONE[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT_TONE[tone]}`} />
      {label}
    </span>
  );
}

/** A macOS permission row: icon, label + desc, and a granted/needed pill. */
function PermRow({
  icon: Icon,
  label,
  desc,
  granted,
  grantedLabel,
  neededLabel,
}: {
  icon: typeof Accessibility;
  label: string;
  desc: string;
  granted: boolean;
  grantedLabel: string;
  neededLabel: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-fg-secondary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg-primary text-sm">{label}</div>
        <div className="mt-0.5 text-fg-tertiary text-xs">{desc}</div>
      </div>
      {granted ? (
        <span className="inline-flex items-center gap-1 font-medium text-success text-xs">
          <Check className="size-3.5" />
          {grantedLabel}
        </span>
      ) : (
        <Pill tone="warn" label={neededLabel} />
      )}
    </div>
  );
}

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
  const { value: menubarStatus, set: setMenubar } = useSetting('computerUse.menubarStatus');
  const { value: pauseOnInput, set: setPause } = useSetting('computerUse.pauseOnInput');
  const { value: confirmSensitive, set: setConfirm } = useSetting('computerUse.confirmSensitive');

  // Off macOS the feature can't run; show a coming-soon note instead of controls.
  if (perms.data && !perms.data.supported) {
    return <ComingSoon />;
  }

  const accessibility = perms.data?.accessibility ?? false;
  const screenRecording = perms.data?.screenRecording ?? false;
  const bothGranted = accessibility && screenRecording;

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
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-fg-primary text-sm">
              {t('settings.computer.permissionsTitle')}
              <Pill
                tone={bothGranted ? 'ok' : 'warn'}
                label={
                  bothGranted ? t('settings.computer.permReady') : t('settings.computer.permNeeded')
                }
              />
            </h2>
            <div className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
              <PermRow
                icon={Accessibility}
                label={t('settings.computer.accessibility')}
                desc={t('settings.computer.accessibilityDesc')}
                granted={accessibility}
                grantedLabel={t('settings.computer.granted')}
                neededLabel={t('settings.computer.needed')}
              />
              <PermRow
                icon={Video}
                label={t('settings.computer.screenRecording')}
                desc={t('settings.computer.screenRecordingDesc')}
                granted={screenRecording}
                grantedLabel={t('settings.computer.granted')}
                neededLabel={t('settings.computer.needed')}
              />
            </div>
            {!bothGranted && (
              <div className="mt-2 flex items-start gap-1.5 text-fg-tertiary text-xs">
                <Info className="size-3.5 shrink-0" />
                <span>{t('settings.computer.permHint')}</span>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-semibold text-fg-primary text-sm">
              {t('settings.computer.behaviorTitle')}
            </h2>
            <div className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
              <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-fg-primary text-sm">
                    <MousePointerClick className="size-3.5 text-fg-tertiary" />
                    {t('settings.computer.menubar')}
                  </div>
                  <div className="mt-0.5 text-fg-tertiary text-xs">
                    {t('settings.computer.menubarDesc')}
                  </div>
                </div>
                <EnableSwitch on={menubarStatus} onToggle={() => setMenubar(!menubarStatus)} />
              </div>
              <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="font-medium text-fg-primary text-sm">
                    {t('settings.computer.pause')}
                  </div>
                  <div className="mt-0.5 text-fg-tertiary text-xs">
                    {t('settings.computer.pauseDesc')}
                  </div>
                </div>
                <EnableSwitch on={pauseOnInput} onToggle={() => setPause(!pauseOnInput)} />
              </div>
              <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="font-medium text-fg-primary text-sm">
                    {t('settings.computer.confirm')}
                  </div>
                  <div className="mt-0.5 text-fg-tertiary text-xs">
                    {t('settings.computer.confirmDesc')}
                  </div>
                </div>
                <EnableSwitch
                  on={confirmSensitive}
                  onToggle={() => setConfirm(!confirmSensitive)}
                />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
