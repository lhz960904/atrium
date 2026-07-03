import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, CheckCircle2, Download, Loader2, RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../lib/trpc';
import { useUpdateStore } from '../state/update-store';

const MB = 1024 * 1024;
const fmtMB = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

function fmtEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Drop release-please's trailing "(#30) (faeb8e2)" PR/commit refs — noise here. */
function cleanItem(text: string): string {
  return text
    .replace(/\s*\(#\d+\)/g, '')
    .replace(/\s*\([0-9a-f]{7,40}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * electron-updater's GitHub provider returns release notes as HTML (from the
 * releases atom feed), so parse it into clean, structured content rather than
 * dumping raw tags: drop the redundant version header (the dialog already shows
 * the version compare), keep section headings, and turn the change list into
 * plain bullets without the PR/commit link noise. Falls back to plain text.
 */
function buildReleaseNotes(html: string): React.JSX.Element | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: React.JSX.Element[] = [];
  let key = 0;

  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2') continue; // version header — redundant
    if (tag === 'h3' || tag === 'h4') {
      const text = el.textContent?.trim();
      if (text)
        blocks.push(
          <div
            key={key++}
            className="font-medium text-[11px] text-fg-tertiary uppercase tracking-wide"
          >
            {text}
          </div>,
        );
    } else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.querySelectorAll('li'))
        .map((li) => cleanItem(li.textContent ?? ''))
        .filter(Boolean);
      if (items.length)
        blocks.push(
          <ul key={key++} className="flex flex-col gap-1">
            {items.map((it) => (
              <li key={it} className="flex gap-2">
                <span className="text-fg-disabled">•</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>,
        );
    } else {
      const text = el.textContent?.trim();
      if (text) blocks.push(<p key={key++}>{text}</p>);
    }
  }

  if (blocks.length === 0) {
    // Plain-text notes (no block markup).
    const text = doc.body.textContent?.trim();
    return text ? <div className="whitespace-pre-wrap">{text}</div> : null;
  }
  return <div className="flex flex-col gap-2.5">{blocks}</div>;
}

function ReleaseNotes({ html }: { html: string }): React.JSX.Element | null {
  return useMemo(() => buildReleaseNotes(html), [html]);
}

/**
 * The Software Update modal, driven entirely by the update store. It opens from
 * the sidebar entry (never on its own) and reflects the current stage: version
 * compare + notes while available, live progress while downloading, and a
 * ready-to-install banner once downloaded. v1 is click-to-download, so Download
 * is the primary action until the package is in hand, then Restart Now.
 */
export function UpdateDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const state = useUpdateStore((s) => s.state);
  const dialogOpen = useUpdateStore((s) => s.dialogOpen);
  const closeDialog = useUpdateStore((s) => s.closeDialog);
  const check = trpc.update.check.useMutation();
  const download = trpc.update.download.useMutation();
  const install = trpc.update.install.useMutation();

  const { stage, currentVersion, info, progress, error } = state;

  const ghostBtn =
    'rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary';
  const accentBtn =
    'flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-fg-on-accent text-sm hover:bg-accent-hover disabled:opacity-60';

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex w-[min(440px,92vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none"
        >
          <div className="flex flex-col gap-4 p-6">
            <Dialog.Title className="font-semibold text-fg-primary text-lg">
              {t('update.title')}
            </Dialog.Title>

            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="text-fg-tertiary">{currentVersion}</span>
              <ArrowRight className="size-4 shrink-0 text-fg-tertiary" />
              <span className="text-fg-primary">{info?.version}</span>
            </div>

            {info?.releaseNotes && (
              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-fg-tertiary text-xs uppercase tracking-wide">
                  {t('update.whatsNew')}
                </span>
                <div className="max-h-40 overflow-y-auto text-fg-secondary text-sm leading-relaxed">
                  <ReleaseNotes html={info.releaseNotes} />
                </div>
              </div>
            )}

            {stage === 'downloading' && progress && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-fg-secondary text-sm">
                  <span>{t('update.downloading')}</span>
                  <span>
                    {fmtMB(progress.transferred)} / {fmtMB(progress.total)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-strong">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-fg-tertiary text-xs">
                  <span>{fmtMB(progress.bytesPerSecond)}/s</span>
                  <span>
                    {t('update.eta', {
                      eta: fmtEta(
                        (progress.total - progress.transferred) / progress.bytesPerSecond,
                      ),
                    })}
                  </span>
                </div>
              </div>
            )}

            {stage === 'downloaded' && (
              <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>{t('update.downloadComplete')}</span>
              </div>
            )}

            {stage === 'error' && error && (
              <div className="rounded-lg bg-danger/10 px-3 py-2.5 text-danger text-sm">{error}</div>
            )}
          </div>

          <div className="flex justify-end gap-1 border-border-default border-t px-4 py-3">
            {stage === 'downloaded' ? (
              <>
                <button type="button" className={ghostBtn} onClick={closeDialog}>
                  {t('update.later')}
                </button>
                <button type="button" className={accentBtn} onClick={() => install.mutate()}>
                  <RotateCw className="size-4" />
                  {t('update.restartNow')}
                </button>
              </>
            ) : stage === 'downloading' ? (
              <>
                <button type="button" className={ghostBtn} onClick={closeDialog}>
                  {t('update.later')}
                </button>
                <button type="button" className={accentBtn} disabled>
                  <Loader2 className="size-4 animate-spin" />
                  {t('update.downloading')}
                </button>
              </>
            ) : stage === 'error' ? (
              <>
                <button type="button" className={ghostBtn} onClick={closeDialog}>
                  {t('common.close')}
                </button>
                <button type="button" className={accentBtn} onClick={() => check.mutate()}>
                  {t('update.retry')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className={ghostBtn} onClick={closeDialog}>
                  {t('common.cancel')}
                </button>
                <button type="button" className={accentBtn} onClick={() => download.mutate()}>
                  <Download className="size-4" />
                  {t('update.download')}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
