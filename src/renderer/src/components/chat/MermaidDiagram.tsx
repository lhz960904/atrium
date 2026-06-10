import { Scan, Workflow } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from 'react-zoom-pan-pinch';
import { useThemeStore } from '../../state/theme-store';
import { CodeBlock } from './CodeBlock';
import { CopyButton } from './CopyButton';

// Mermaid is heavy; import it lazily so it only loads when a diagram appears.
let seq = 0;

/**
 * Renders a ```mermaid block as an SVG diagram inside a pan/zoom canvas: it
 * auto-fits so the whole diagram is visible, then the user can drag to pan and
 * wheel to zoom in (double-click resets). While the chart streams in it's
 * usually unparseable, so we fall back to its source.
 */
export function MermaidDiagram({ chart }: { chart: string }): React.JSX.Element {
  const { t } = useTranslation();
  const dark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const [svg, setSvg] = useState('');
  const apiRef = useRef<ReactZoomPanPinchRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    seq += 1;
    const id = `mermaid-${seq}`;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setSvg('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, dark]);

  // Scale the diagram so the whole thing fits the canvas — the "home" view.
  const fit = useCallback((ms = 0): void => {
    if (contentRef.current) apiRef.current?.zoomToElement(contentRef.current, undefined, ms);
  }, []);

  // Fit once the SVG lands in the DOM.
  useEffect(() => {
    if (!svg) return;
    const raf = requestAnimationFrame(() => fit(0));
    return () => cancelAnimationFrame(raf);
  }, [svg, fit]);

  if (!svg) return <CodeBlock code={chart} lang="mermaid" />;

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-default">
      <div className="flex items-center justify-between bg-surface px-3 py-1.5 text-fg-tertiary text-xs">
        <span className="flex items-center gap-1.5">
          <Workflow className="size-3.5" />
          mermaid
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => fit(200)}
            className="rounded p-1 text-fg-tertiary transition-colors hover:bg-elevated hover:text-fg-secondary"
            title={t('common.fitToView')}
          >
            <Scan className="size-3.5" />
          </button>
          <CopyButton text={chart} />
        </div>
      </div>
      <TransformWrapper
        ref={apiRef}
        minScale={0.1}
        maxScale={8}
        limitToBounds={false}
        // Smaller step = gentler, smoother wheel zoom (0.08 felt too jumpy).
        wheel={{ step: 0.015 }}
        doubleClick={{ disabled: true }}
      >
        <TransformComponent
          wrapperClass="!h-[360px] !w-full cursor-grab bg-code-bg active:cursor-grabbing"
          contentClass="!h-full !w-full items-center justify-center"
        >
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG produced by mermaid from the model's chart */}
          <div ref={contentRef} dangerouslySetInnerHTML={{ __html: svg }} />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
