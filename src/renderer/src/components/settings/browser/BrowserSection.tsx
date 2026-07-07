import {
  Check,
  Globe,
  Info,
  Lock,
  Monitor,
  Plug,
  Puzzle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { useSetting } from '../../../lib/use-setting';
import { EnableSwitch } from '../providers/EnableSwitch';

// Where the user installs the pieces. The extension is the official Playwright
// Extension on the Chrome Web Store; Chrome itself when it isn't installed.
const EXTENSION_URL =
  'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm';
const CHROME_URL = 'https://www.google.com/chrome/';

/**
 * The signed-in browser's readiness, from the user's point of view:
 *  - `no-chrome`  — Chrome isn't installed, so login mode can't work at all
 *  - `setup`      — Chrome is here but the extension/bridge isn't connected yet
 *  - `connected`  — the bridge is live; the agent can use the signed-in browser
 * The public browser is always available regardless.
 */
type BrowserPhase = 'no-chrome' | 'setup' | 'connected';

type PillTone = 'ok' | 'off' | 'warn';

const PILL_TONE: Record<PillTone, string> = {
  ok: 'bg-success/12 text-success',
  off: 'bg-surface-strong text-fg-tertiary',
  warn: 'bg-warning/14 text-warning',
};
const DOT_TONE: Record<PillTone, string> = {
  ok: 'bg-success',
  off: 'bg-fg-disabled',
  warn: 'bg-warning',
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

const PRIMARY_BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-fg-on-accent text-sm hover:bg-accent-hover';
const GHOST_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-border-default px-2.5 py-1 font-medium text-fg-secondary text-xs hover:bg-elevated';

/** A numbered/iconed step inside the setup card. */
function Step({
  marker,
  tone = 'active',
  title,
  desc,
  children,
}: {
  marker: React.ReactNode;
  tone?: 'active' | 'idle' | 'warn' | 'done';
  title: string;
  desc: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const markerTone =
    tone === 'done'
      ? 'bg-success/12 text-success'
      : tone === 'warn'
        ? 'bg-warning/14 text-warning'
        : tone === 'active'
          ? 'bg-accent-soft text-accent'
          : 'border border-border-default bg-surface-strong text-fg-secondary';
  return (
    <div className="flex gap-3.5 p-4">
      <div
        className={`flex size-6 shrink-0 items-center justify-center rounded-full font-semibold text-xs ${markerTone}`}
      >
        {marker}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`font-semibold text-sm ${tone === 'idle' ? 'text-fg-disabled' : 'text-fg-primary'}`}
        >
          {title}
        </div>
        <div className="mt-0.5 max-w-[460px] text-fg-tertiary text-xs">{desc}</div>
        {children && <div className="mt-2.5">{children}</div>}
      </div>
    </div>
  );
}

/** A small note line under a step or card (info by default, warning tone available). */
function Hint({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn';
  children: React.ReactNode;
}): React.JSX.Element {
  const Icon = tone === 'warn' ? TriangleAlert : Info;
  return (
    <div className="mt-2 flex items-start gap-1.5 text-fg-tertiary text-xs">
      <Icon
        className={`size-3.5 shrink-0 ${tone === 'warn' ? 'text-warning' : 'text-fg-tertiary'}`}
      />
      <span>{children}</span>
    </div>
  );
}

/** Current phase of the signed-in browser. Returns BrowserPhase (not a narrowed
 *  literal) so every branch stays type-valid regardless of the current values. */
function deriveBrowserPhase(chromeInstalled: boolean, connected: boolean): BrowserPhase {
  if (!chromeInstalled) return 'no-chrome';
  return connected ? 'connected' : 'setup';
}

export function BrowserSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { value: enabled, set: setEnabled } = useSetting('browser.enabled');
  const utils = trpc.useUtils();
  const env = trpc.browser.environment.useQuery();
  // Assume Chrome is present until the probe resolves, so a machine that has it
  // doesn't flash the "install Chrome" state on load.
  const chromeInstalled = env.data?.chromeInstalled ?? true;
  const extensionInstalled = env.data?.extensionInstalled ?? false;
  const connected = env.data?.connected ?? false;
  // No Chrome means the feature can't run, so it reads as off and the switch is
  // disabled; with Chrome it follows the stored preference.
  const effectiveOn = enabled && chromeInstalled;
  const phase = deriveBrowserPhase(chromeInstalled, connected);

  const refreshEnv = (): void => void utils.browser.environment.invalidate();
  const connect = trpc.browser.connect.useMutation({ onSuccess: refreshEnv });
  const disconnect = trpc.browser.disconnect.useMutation({ onSuccess: refreshEnv });

  const setupPill =
    phase === 'connected'
      ? { tone: 'ok' as const, label: t('settings.browser.statusConnected') }
      : phase === 'no-chrome'
        ? { tone: 'warn' as const, label: t('settings.browser.statusChromeNotFound') }
        : { tone: 'off' as const, label: t('settings.browser.statusNotConnected') };

  const signedInMode =
    phase === 'connected'
      ? { tone: 'ok' as const, label: t('settings.browser.modeReady') }
      : phase === 'no-chrome'
        ? { tone: 'warn' as const, label: t('settings.browser.modeNeedsChrome') }
        : { tone: 'off' as const, label: t('settings.browser.modeNeedsSetup') };

  return (
    <div className="flex flex-col gap-7">
      <p className="max-w-[620px] text-fg-tertiary text-sm">{t('settings.browser.lede')}</p>

      {/* Master toggle */}
      <div className="rounded-xl border border-border-default bg-surface">
        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
          <div className="min-w-0">
            <div className="font-medium text-fg-primary text-sm">
              {t('settings.browser.control')}
            </div>
            <div className="mt-0.5 text-fg-tertiary text-xs">
              {t('settings.browser.controlDesc')}
            </div>
          </div>
          <EnableSwitch
            on={effectiveOn}
            disabled={!chromeInstalled}
            onToggle={() => setEnabled(!enabled)}
          />
        </div>
      </div>

      {(!chromeInstalled || effectiveOn) && phase !== 'connected' && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-fg-primary text-sm">
            {t('settings.browser.setup')}
            <Pill tone={setupPill.tone} label={setupPill.label} />
          </h2>
          <div className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
            {phase === 'no-chrome' ? (
              <Step
                marker={<TriangleAlert className="size-3.5" />}
                tone="warn"
                title={t('settings.browser.installChrome')}
                desc={t('settings.browser.installChromeDesc')}
              >
                <a href={CHROME_URL} target="_blank" rel="noreferrer" className={PRIMARY_BTN}>
                  <Globe className="size-4" />
                  {t('settings.browser.installChromeBtn')}
                </a>
                <Hint>{t('settings.browser.installChromeHint')}</Hint>
              </Step>
            ) : (
              <>
                <Step
                  marker={extensionInstalled ? <Check className="size-3.5" /> : '1'}
                  tone={extensionInstalled ? 'done' : 'active'}
                  title={t('settings.browser.installExt')}
                  desc={t('settings.browser.installExtDesc')}
                >
                  {extensionInstalled ? (
                    <span className="font-medium text-success text-xs">
                      {t('settings.browser.extInstalled')}
                    </span>
                  ) : (
                    <a
                      href={EXTENSION_URL}
                      target="_blank"
                      rel="noreferrer"
                      className={PRIMARY_BTN}
                    >
                      <Puzzle className="size-4" />
                      {t('settings.browser.installExtBtn')}
                    </a>
                  )}
                </Step>
                <Step
                  marker="2"
                  tone={extensionInstalled ? 'active' : 'idle'}
                  title={t('settings.browser.connect')}
                  desc={t('settings.browser.connectDesc')}
                >
                  <button
                    type="button"
                    onClick={() => connect.mutate()}
                    disabled={!extensionInstalled || connect.isPending}
                    className={`${PRIMARY_BTN} disabled:opacity-45`}
                  >
                    <Plug className="size-4" />
                    {t('settings.browser.connectBtn')}
                  </button>
                </Step>
              </>
            )}
          </div>
        </section>
      )}

      {effectiveOn && phase === 'connected' && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-fg-primary text-sm">
            {t('settings.browser.connectionTitle')}
            <Pill tone="ok" label={t('settings.browser.statusConnected')} />
          </h2>
          <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
            <div className="flex items-center justify-between gap-6 px-4 py-3.5">
              <div className="min-w-0">
                <div className="font-medium text-fg-primary text-sm">
                  {t('settings.browser.connectionSession')}
                </div>
                <div className="mt-0.5 text-fg-tertiary text-xs">
                  {t('settings.browser.connectionSessionDesc')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                  className={`${GHOST_BTN} disabled:opacity-45`}
                >
                  <RefreshCw className="size-3.5" />
                  {t('settings.browser.reconnect')}
                </button>
                <button
                  type="button"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                  className={`${GHOST_BTN} disabled:opacity-45`}
                >
                  {t('settings.browser.disconnect')}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-border-default border-t bg-elevated px-4 py-3">
              <Pill tone="ok" label={t('settings.browser.extensionLinked')} />
              <span className="text-fg-secondary text-xs">
                {t('settings.browser.tabGroupNote')}
              </span>
            </div>
          </div>
        </section>
      )}

      {effectiveOn && (
        <section>
          <h2 className="mb-3 font-semibold text-fg-primary text-sm">
            {t('settings.browser.modesTitle')}
          </h2>
          <div className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-fg-secondary">
                <Monitor className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg-primary text-sm">
                  {t('settings.browser.modePublic')}
                </div>
                <div className="mt-0.5 text-fg-tertiary text-xs">
                  {t('settings.browser.modePublicDesc')}
                </div>
              </div>
              <Pill tone="ok" label={t('settings.browser.modeReady')} />
            </div>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-fg-secondary">
                <Lock className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg-primary text-sm">
                  {t('settings.browser.modeSignedIn')}
                </div>
                <div className="mt-0.5 text-fg-tertiary text-xs">
                  {t('settings.browser.modeSignedInDesc')}
                  <Hint tone="warn">{t('settings.browser.bannerNote')}</Hint>
                </div>
              </div>
              <Pill tone={signedInMode.tone} label={signedInMode.label} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
