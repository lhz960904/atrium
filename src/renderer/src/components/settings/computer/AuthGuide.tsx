import { COMPUTER_USE_DRAG_CHANNEL, type PrivacyPane } from '@shared/computer-use';
import { Accessibility, Check, MousePointerClick, Video, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

type PillTone = 'ok' | 'warn' | 'busy';
const PILL_TONE: Record<PillTone, string> = {
  ok: 'bg-success/12 text-success',
  warn: 'bg-warning/14 text-warning',
  busy: 'bg-accent/12 text-accent',
};
const DOT_TONE: Record<PillTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  busy: 'bg-accent',
};

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

function GrantRow({
  icon: Icon,
  accent,
  title,
  desc,
  granted,
  grantedLabel,
  grantLabel,
  onGrant,
}: {
  icon: typeof Accessibility;
  accent?: boolean;
  title: string;
  desc: string;
  granted: boolean;
  grantedLabel: string;
  grantLabel: string;
  onGrant: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${
          accent ? 'bg-[#2E7CF6] text-white' : 'bg-surface-strong text-fg-secondary'
        }`}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-fg-primary text-sm">{title}</div>
        <div className="mt-0.5 text-fg-tertiary text-xs">{desc}</div>
      </div>
      {granted ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-3 py-1.5 font-semibold text-success text-xs">
          <Check className="size-3.5" />
          {grantedLabel}
        </span>
      ) : (
        <button
          type="button"
          onClick={onGrant}
          className="ml-auto shrink-0 rounded-full bg-surface-strong px-4 py-1.5 font-semibold text-accent text-xs transition-colors hover:bg-accent/10"
        >
          {grantLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Drag-to-grant guide, shared by the settings page and the runtime permission
 * modal. Clicking a grant opens the matching System Settings pane and reveals a
 * floating source the user drags into that list — the real grant is confirmed by
 * the permission poll driving `accessibility`/`screenRecording`, not by any drop
 * we can observe (the drop lands in another app's window). Once both land it
 * self-restarts, but only if the user actually ran the flow here: opening an
 * already-granted page must never restart on its own.
 */
export function AuthGuide({
  accessibility,
  screenRecording,
}: {
  accessibility: boolean;
  screenRecording: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const openPane = trpc.computer.openPrivacyPane.useMutation();
  const relaunch = trpc.computer.relaunch.useMutation();
  const [active, setActive] = useState<PrivacyPane | null>(null);
  const [restarting, setRestarting] = useState(false);
  const guided = useRef(false);

  const bothGranted = accessibility && screenRecording;

  useEffect(() => {
    if (!active) return;
    const granted = active === 'accessibility' ? accessibility : screenRecording;
    if (granted) setActive(null);
  }, [active, accessibility, screenRecording]);

  useEffect(() => {
    if (bothGranted && guided.current && !restarting) {
      setRestarting(true);
      relaunch.mutate();
    }
  }, [bothGranted, restarting, relaunch]);

  function grant(pane: PrivacyPane): void {
    guided.current = true;
    setActive(pane);
    openPane.mutate(pane);
  }

  function startDrag(event: React.DragEvent): void {
    // startDrag must fire from the gesture; the main process owns the payload.
    event.preventDefault();
    window.electron.ipcRenderer.send(COMPUTER_USE_DRAG_CHANNEL);
  }

  const activeName = active
    ? t(`settings.computer.${active === 'accessibility' ? 'accessibility' : 'screenRecording'}`)
    : '';

  return (
    <section>
      <h2 className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-semibold text-fg-primary text-sm">
        {t('settings.computer.permissionsTitle')}
        {restarting ? (
          <Pill tone="busy" label={t('settings.computer.restarting')} />
        ) : bothGranted ? (
          <Pill tone="ok" label={t('settings.computer.permReady')} />
        ) : (
          <Pill tone="warn" label={t('settings.computer.permNeeded')} />
        )}
        {!bothGranted && !restarting && (
          <span className="max-w-[360px] font-medium text-warning text-xs leading-snug">
            {t('settings.computer.restartNote')}
          </span>
        )}
      </h2>

      <div className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
        <GrantRow
          icon={Accessibility}
          accent
          title={t('settings.computer.accessibility')}
          desc={t('settings.computer.accessibilityDesc')}
          granted={accessibility}
          grantedLabel={t('settings.computer.granted')}
          grantLabel={t('settings.computer.grant')}
          onGrant={() => grant('accessibility')}
        />
        <GrantRow
          icon={Video}
          title={t('settings.computer.screenRecording')}
          desc={t('settings.computer.screenRecordingDesc')}
          granted={screenRecording}
          grantedLabel={t('settings.computer.granted')}
          grantLabel={t('settings.computer.grant')}
          onGrant={() => grant('screenRecording')}
        />
      </div>

      {active && (
        <div className="fixed right-5 bottom-5 z-50 w-[310px] rounded-2xl border border-border-default bg-elevated p-4 shadow-lg">
          <div className="flex items-center gap-2 font-semibold text-fg-primary text-sm">
            {t('settings.computer.dragTitle', { name: activeName })}
            <button
              type="button"
              onClick={() => setActive(null)}
              className="ml-auto rounded-md p-0.5 text-fg-tertiary transition-colors hover:bg-surface-strong hover:text-fg-secondary"
              aria-label={t('settings.computer.dragClose')}
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-fg-secondary text-xs leading-relaxed">
            {t('settings.computer.dragDesc')}
          </p>
          <button
            type="button"
            draggable
            onDragStart={startDrag}
            className="mt-3 flex w-full cursor-grab items-center gap-2.5 rounded-[10px] border border-border-default bg-surface px-3 py-2.5 text-left shadow-sm active:cursor-grabbing"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#8E9BFF] via-[#C6A2FF] to-[#F0A9C7] text-white">
              <MousePointerClick className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-[13px] text-fg-primary">
                {t('settings.computer.dragName')}
              </span>
              <span className="block font-mono text-[11px] text-fg-tertiary">
                {t('settings.computer.dragHint')}
              </span>
            </span>
          </button>
          <div className="mt-2.5 rounded-[10px] border border-border-default border-dashed px-3 py-3.5 text-center">
            <span className="mb-1 block font-mono text-[10px] text-fg-tertiary uppercase tracking-wider">
              {t('settings.computer.dropHead', { name: activeName })}
            </span>
            <span className="text-fg-tertiary text-xs">{t('settings.computer.dropHint')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
