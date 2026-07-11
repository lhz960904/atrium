import { COMPUTER_USE_OVERLAY_CLOSED_CHANNEL, type PrivacyPane } from '@shared/computer-use';
import { Accessibility, Check, Video } from 'lucide-react';
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
 * Drag-to-grant guide. Clicking a grant opens the matching System Settings pane
 * and shows a separate always-on-top drag window (owned by the main process)
 * that floats over Settings without covering it — the source lives outside this
 * window so Settings keeps focus while the user drags Atrium's bundle into its
 * list. The grant is confirmed by the permission poll, not a drop we can observe;
 * once both land it self-restarts, but only after a grant flow the user actually
 * started here, so an already-granted page never restarts on its own.
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
  const showOverlay = trpc.computer.showDragOverlay.useMutation();
  const hideOverlay = trpc.computer.hideDragOverlay.useMutation();
  // react-query keeps `.mutate` referentially stable; capture it so effects (and
  // the unmount cleanup) key off a stable value instead of the mutation object,
  // which is new every render and would otherwise loop the cleanup.
  const hideDrag = hideOverlay.mutate;
  const doRelaunch = relaunch.mutate;
  const [activePane, setActivePane] = useState<PrivacyPane | null>(null);
  const [restarting, setRestarting] = useState(false);
  const guided = useRef(false);

  const bothGranted = accessibility && screenRecording;

  useEffect(() => {
    if (!activePane) return;
    const granted = activePane === 'accessibility' ? accessibility : screenRecording;
    if (granted) {
      setActivePane(null);
      hideDrag();
    }
  }, [activePane, accessibility, screenRecording, hideDrag]);

  // The overlay's own close button clears the active pane back here.
  useEffect(() => {
    return window.electron?.ipcRenderer.on(COMPUTER_USE_OVERLAY_CLOSED_CHANNEL, () => {
      setActivePane(null);
    });
  }, []);

  // Leaving the page mid-flow should take the floating window with it.
  useEffect(() => {
    return () => {
      hideDrag();
    };
  }, [hideDrag]);

  useEffect(() => {
    if (bothGranted && guided.current && !restarting) {
      setRestarting(true);
      doRelaunch();
    }
  }, [bothGranted, restarting, doRelaunch]);

  function grant(pane: PrivacyPane): void {
    guided.current = true;
    setActivePane(pane);
    openPane.mutate(pane);
    const name = t(
      `settings.computer.${pane === 'accessibility' ? 'accessibility' : 'screenRecording'}`,
    );
    showOverlay.mutate({
      heading: t('settings.computer.dragHeading', {
        app: t('settings.computer.dragName'),
        perm: name,
      }),
      name: t('settings.computer.dragName'),
      dragLabel: t('settings.computer.dragLabel'),
      closeLabel: t('settings.computer.dragClose'),
    });
  }

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
    </section>
  );
}
