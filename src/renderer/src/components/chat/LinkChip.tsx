import { Globe } from 'lucide-react';
import { type ReactNode, useState } from 'react';

function httpUrl(href: string): URL | null {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}

/**
 * A favicon can load "successfully" yet be invisible: a corrupt file decodes to
 * fully transparent pixels, and near-black artwork vanishes on the dark theme.
 * onError catches neither, so the decoded pixels are inspected once per host —
 * blank icons fall back to the globe, dark ones get a light backing plate.
 */
type Verdict = 'ok' | 'dark' | 'blank';
// Markdown remounts chips on every stream chunk; verdicts are keyed by host so
// each icon pays the pixel scan once per session.
const verdicts = new Map<string, Verdict>();

function inspect(img: HTMLImageElement): Verdict {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'ok';
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, size, size);
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return 'ok'; // undrawable or tainted — can't tell, keep the image
  }
  let opaque = 0;
  let luma = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    opaque++;
    luma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  if (opaque < size * size * 0.02) return 'blank';
  return luma / opaque < 60 ? 'dark' : 'ok';
}

// The favicon is served by the main process over the atrium-favicon:// scheme
// (see main/favicons.ts). A host with no icon 404s — swap in a neutral globe.
function Favicon({ host }: { host: string }): React.JSX.Element {
  const [verdict, setVerdict] = useState<Verdict>(() => verdicts.get(host) ?? 'ok');
  const cls = 'mr-1 inline-block h-[0.95em] w-[0.95em] shrink-0 align-[-0.15em]';
  if (verdict === 'blank') return <Globe className={`${cls} text-fg-tertiary`} aria-hidden />;
  const plate = verdict === 'dark' ? ' dark:bg-white/90 dark:p-px' : '';
  return (
    <img
      src={`atrium-favicon://${host}`}
      alt=""
      aria-hidden
      loading="lazy"
      crossOrigin="anonymous"
      onLoad={(e) => {
        if (verdicts.has(host)) return;
        const v = inspect(e.currentTarget);
        verdicts.set(host, v);
        setVerdict(v);
      }}
      onError={() => {
        verdicts.set(host, 'blank');
        setVerdict('blank');
      }}
      className={`${cls} rounded-[3px] object-contain${plate}`}
    />
  );
}

const ANCHOR = 'font-medium text-accent no-underline hover:underline';

/**
 * Renders a Markdown link as a compact favicon + label chip instead of a raw
 * URL. A model-supplied link text is kept as the label; a bare autolink (whose
 * text is just the URL) collapses to its hostname so it reads as a source, not a
 * wall of query string.
 */
export function LinkChip({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const host = (href ? httpUrl(href) : null)?.hostname ?? '';
  // No favicon lookup for a relative/mailto link, or a URL still arriving
  // token-by-token mid-stream (a hostname without a dot isn't complete yet).
  if (!href || !host.includes('.')) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${ANCHOR} wrap-anywhere`}>
        {children}
      </a>
    );
  }
  const label = textOf(children).trim();
  const bare = !label || label.replace(/\/+$/, '') === href.replace(/\/+$/, '');
  const display: ReactNode = bare ? host.replace(/^www\./, '') : children;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} className={ANCHOR}>
      <Favicon host={host} />
      {display}
    </a>
  );
}
