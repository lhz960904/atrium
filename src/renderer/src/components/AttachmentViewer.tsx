import * as Dialog from '@radix-ui/react-dialog';
import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAttachmentViewer, type ViewerFile } from '../state/attachment-viewer-store';

/** Decode a base64 text data URL back to its source. */
function decodeText(url: string, fallback: string): string {
  const base64 = url.slice(url.indexOf(',') + 1);
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    return fallback;
  }
}

/** data URL → Blob. PDFs are framed from a blob: URL — the CSP allows framing
 *  blob: but not data:, and blob URLs also handle large files better. */
function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  const mediaType = url.slice(5, comma).split(';')[0] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mediaType });
}

function download(file: ViewerFile): void {
  const a = document.createElement('a');
  a.href = file.url;
  a.download = file.filename;
  a.click();
}

/**
 * A global lightbox/viewer for message attachments, sourced entirely from the
 * embedded data URL (no original-file dependency). Images open enlarged; text
 * shows its decoded content. Mounted once at the app root.
 */
export function AttachmentViewer(): React.JSX.Element {
  const { t } = useTranslation();
  const file = useAttachmentViewer((s) => s.file);
  const close = useAttachmentViewer((s) => s.close);
  const isImage = file?.mediaType.startsWith('image/') ?? false;
  const isPdf = file?.mediaType === 'application/pdf';

  // PDFs render in an iframe from a blob: URL (CSP blocks framing data:). Mint
  // it while a PDF is open and revoke it on close so it doesn't leak.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || file.mediaType !== 'application/pdf') {
      setPdfUrl(null);
      return;
    }
    const url = URL.createObjectURL(dataUrlToBlob(file.url));
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <Dialog.Root
      open={file !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[var(--z-modal)] flex w-[min(820px,90vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none ${
            // a PDF iframe has no intrinsic height, so give it a fixed tall box;
            // images/text size to their content, capped.
            isPdf ? 'h-[80vh]' : 'max-h-[80vh]'
          }`}
        >
          {file && (
            <>
              <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-4 py-2.5">
                <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
                  {file.filename}
                </Dialog.Title>
                <button
                  type="button"
                  title={t('common.download')}
                  onClick={() => download(file)}
                  className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
                >
                  <Download className="size-4" />
                </button>
                <Dialog.Close
                  className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
                  title={t('common.close')}
                >
                  <X className="size-4" />
                </Dialog.Close>
              </div>

              {isImage ? (
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas p-4">
                  <img
                    src={file.url}
                    alt={file.filename}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : isPdf ? (
                <iframe
                  src={pdfUrl ?? undefined}
                  title={file.filename}
                  className="min-h-0 w-full flex-1 bg-canvas"
                />
              ) : (
                <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-fg-secondary text-xs leading-relaxed">
                  {decodeText(file.url, t('attachmentViewer.unreadable'))}
                </pre>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
