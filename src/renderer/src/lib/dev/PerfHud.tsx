import { Activity, ChevronDown, Download, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadTrace, jsProfiler, profilerAvailable } from './js-profiler';
import { analyzeTrace, leavesUnder, type ProfilerTrace, type TraceAnalysis } from './perf-analysis';
import { perf } from './perf-recorder';

/**
 * Dev-only floating profiler. One click records a JS self-profile of the main
 * thread (works through freezes), then shows the metrics that actually locate a
 * perf problem: the longest main-thread block and our own components ranked by
 * render cost — no console, no DevTools, no hand-written parse scripts.
 */

type Phase = 'idle' | 'recording' | 'analyzing' | 'done';

function blockColor(ms: number): string {
  if (ms < 50) return 'text-success';
  if (ms < 100) return 'text-warning';
  return 'text-danger';
}

export function PerfHud(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ analysis: TraceAnalysis; trace: ProfilerTrace } | null>(
    null,
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const startRef = useRef(0);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'recording') return;
    return perf.onLongTask(() => {
      setFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 250);
    });
  }, [phase]);

  const start = useCallback((): void => {
    if (!jsProfiler.start()) return;
    perf.clear();
    startRef.current = performance.now();
    setElapsed(0);
    setResult(null);
    setExpanded(null);
    setPhase('recording');
    setOpen(true);
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    setPhase('analyzing');
    const trace = await jsProfiler.stop();
    if (!trace) {
      setPhase('idle');
      return;
    }
    setResult({ analysis: analyzeTrace(trace), trace });
    setPhase('done');
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed right-4 bottom-4 z-[9999] flex size-9 items-center justify-center rounded-full border border-border-default bg-elevated text-fg-secondary shadow-lg hover:text-fg-primary ${
          phase === 'recording' ? 'animate-pulse text-danger' : ''
        }`}
        title="Perf HUD"
      >
        <Activity className="size-4" />
      </button>
    );
  }

  return (
    <div
      className={`fixed right-4 bottom-4 z-[9999] w-80 rounded-xl border bg-elevated text-sm shadow-2xl ${
        flash ? 'border-danger' : 'border-border-default'
      }`}
    >
      <div className="flex items-center justify-between border-border-default border-b px-3 py-2">
        <span className="flex items-center gap-1.5 font-medium text-fg-primary">
          <Activity className="size-3.5" /> Perf HUD
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-fg-tertiary hover:text-fg-primary"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="p-3">
        {phase === 'idle' && <RecordButton onStart={start} available={profilerAvailable()} />}

        {phase === 'recording' && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-fg-secondary">
              <span className="size-2 animate-pulse rounded-full bg-danger" />
              recording · {(elapsed / 1000).toFixed(1)}s
            </span>
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1.5 rounded-md bg-danger/15 px-2.5 py-1.5 text-danger hover:bg-danger/25"
            >
              <Square className="size-3.5" /> Stop
            </button>
          </div>
        )}

        {phase === 'analyzing' && <div className="py-2 text-fg-tertiary">Analyzing…</div>}

        {phase === 'done' && result && (
          <Results
            analysis={result.analysis}
            trace={result.trace}
            expanded={expanded}
            onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
            onAgain={start}
          />
        )}
      </div>
    </div>
  );
}

function RecordButton({
  onStart,
  available,
}: {
  onStart: () => void;
  available: boolean;
}): React.JSX.Element {
  if (!available) {
    return (
      <p className="text-fg-tertiary text-xs leading-relaxed">
        <span className="text-warning">Profiler unavailable.</span> Restart the dev app so the
        js-profiling Document Policy applies.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-fg-on-accent hover:opacity-90"
    >
      <span className="size-2.5 rounded-full bg-fg-on-accent" /> Record
    </button>
  );
}

function Results({
  analysis,
  trace,
  expanded,
  onToggle,
  onAgain,
}: {
  analysis: TraceAnalysis;
  trace: ProfilerTrace;
  expanded: number | null;
  onToggle: (frameId: number) => void;
  onAgain: () => void;
}): React.JSX.Element {
  const max = analysis.components[0]?.inclusiveMs ?? 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat
          label="longest block"
          value={`${Math.round(analysis.longestBlockMs)}ms`}
          color={blockColor(analysis.longestBlockMs)}
        />
        <Stat label="active JS" value={`${Math.round(analysis.activeMs / 1000)}s`} />
        <Stat label="samples" value={String(analysis.samples)} />
      </div>

      <div>
        <div className="mb-1 text-fg-tertiary text-xs">components by render cost</div>
        <div className="flex flex-col gap-0.5">
          {analysis.components.length === 0 && (
            <div className="py-1 text-fg-tertiary text-xs">no app-component time recorded</div>
          )}
          {analysis.components.map((c) => (
            <div key={c.frameId}>
              <button
                type="button"
                onClick={() => onToggle(c.frameId)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface"
              >
                <ChevronDown
                  className={`size-3 shrink-0 text-fg-tertiary transition-transform ${expanded === c.frameId ? '' : '-rotate-90'}`}
                />
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate text-fg-primary text-xs">{c.name}</span>
                  <span
                    className="mt-0.5 block h-1 rounded-full bg-accent/40"
                    style={{ width: `${Math.max(4, (c.inclusiveMs / max) * 100)}%` }}
                  />
                </span>
                <span className="shrink-0 font-mono text-fg-secondary text-xs">
                  {Math.round(c.inclusiveMs)}ms
                </span>
              </button>
              {expanded === c.frameId && (
                <div className="mb-1 ml-6 flex flex-col gap-0.5">
                  {leavesUnder(trace, c.frameId).map((l) => (
                    <div
                      key={l.label}
                      className="flex justify-between text-fg-tertiary text-[11px]"
                    >
                      <span className="min-w-0 truncate">{l.label}</span>
                      <span className="shrink-0 font-mono">{l.ms}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAgain}
          className="flex-1 rounded-md bg-accent px-2.5 py-1.5 font-medium text-fg-on-accent hover:opacity-90"
        >
          Record again
        </button>
        <button
          type="button"
          onClick={() => downloadTrace(trace)}
          className="flex items-center gap-1.5 rounded-md border border-border-default px-2.5 py-1.5 text-fg-secondary hover:text-fg-primary"
        >
          <Download className="size-3.5" /> JSON
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md bg-surface px-1.5 py-1.5">
      <div className={`font-mono font-semibold ${color ?? 'text-fg-primary'}`}>{value}</div>
      <div className="mt-0.5 text-fg-tertiary text-[10px]">{label}</div>
    </div>
  );
}
