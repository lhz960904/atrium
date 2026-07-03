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

// The favicon is served by the main process over the atrium-favicon:// scheme
// (see main/favicons.ts). A host with no icon 404s — swap in a neutral globe.
function Favicon({ host }: { host: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const cls = 'mr-1 inline-block h-[0.95em] w-[0.95em] shrink-0 align-[-0.15em]';
  if (failed) return <Globe className={`${cls} text-fg-tertiary`} aria-hidden />;
  return (
    <img
      src={`atrium-favicon://${host}`}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${cls} rounded-[3px] object-contain`}
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
