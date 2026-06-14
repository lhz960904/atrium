/**
 * Dev-only performance recorder. Passively observes the main thread and buffers
 * the signals that map to perceived jank, so a real reproduction (switching
 * threads, scrolling a long one) can be captured and exported as one structured
 * JSON for offline analysis instead of eyeballing DevTools.
 *
 * Signals:
 *  - longtask: main-thread blocks > 50ms (the actual "卡顿").
 *  - interaction: Event Timing — click/keydown → next paint (INP); this is the
 *    "sidebar 激活卡顿" number, with the clicked target attributed.
 *  - measure: User Timing marks we emit (e.g. thread-switch render→paint).
 *  - frame-drop: long animation frames during an explicit scroll capture window.
 *
 * Auto-installs on import in dev and exposes `window.__atriumPerf`.
 */

type PerfKind = 'longtask' | 'interaction' | 'measure' | 'frame-drop';

type PerfRecord = {
  kind: PerfKind;
  name: string;
  /** ms since timeOrigin */
  start: number;
  /** ms */
  duration: number;
  detail?: Record<string, string | number>;
};

const MAX_RECORDS = 8000;
const round = (n: number): number => Math.round(n * 10) / 10;

function describeTarget(node: EventTarget | null): string {
  if (!node || !(node instanceof Element)) return '';
  const cls =
    typeof node.className === 'string' && node.className
      ? `.${node.className.split(/\s+/)[0]}`
      : '';
  const testid = node.getAttribute('data-testid');
  return `${node.tagName.toLowerCase()}${cls}${testid ? `[${testid}]` : ''}`.slice(0, 80);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return round(sorted[idx]);
}

class PerfRecorder {
  private records: PerfRecord[] = [];
  private frameRaf = 0;
  private installed = false;
  private longTaskListeners = new Set<(durationMs: number) => void>();

  /** Subscribe to main-thread blocks as they happen (drives the HUD's live flash). */
  onLongTask(cb: (durationMs: number) => void): () => void {
    this.longTaskListeners.add(cb);
    return () => this.longTaskListeners.delete(cb);
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    this.observe({ type: 'longtask', buffered: true }, (e) => {
      this.push({
        kind: 'longtask',
        name: e.name || 'longtask',
        start: e.startTime,
        duration: e.duration,
      });
    });

    this.observe({ type: 'event', buffered: true, durationThreshold: 40 }, (entry) => {
      const e = entry as PerformanceEventTiming;
      this.push({
        kind: 'interaction',
        name: e.name,
        start: e.startTime,
        duration: e.duration,
        detail: {
          inputDelay: round(e.processingStart - e.startTime),
          processing: round(e.processingEnd - e.processingStart),
          target: describeTarget(e.target),
        },
      });
    });

    this.observe({ type: 'measure', buffered: true }, (e) => {
      if (!e.name.startsWith('atrium-')) return;
      this.push({ kind: 'measure', name: e.name, start: e.startTime, duration: e.duration });
    });
  }

  private observe(
    options: PerformanceObserverInit & { durationThreshold?: number },
    cb: (entry: PerformanceEntry) => void,
  ): void {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) cb(entry);
      });
      obs.observe(options as PerformanceObserverInit);
    } catch {
      // entry type unsupported in this Chromium — skip it
    }
  }

  private push(r: PerfRecord): void {
    this.records.push(r);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    if (r.kind === 'longtask') for (const cb of this.longTaskListeners) cb(r.duration);
  }

  /** Mark the start of a thread switch (called during the first render of a new
   *  threadId); the matching measure is emitted once it paints. */
  markThreadStart(): void {
    try {
      performance.mark('atrium-ts-start');
    } catch {}
  }

  measureThreadSwitch(label: string): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          performance.measure(`atrium-thread-switch ${label}`, 'atrium-ts-start');
        } catch {}
      }),
    );
  }

  /** Record long animation frames for `ms` — call it, then scroll the thread. */
  frames(ms = 8000): void {
    cancelAnimationFrame(this.frameRaf);
    let last = performance.now();
    const end = last + ms;
    const tick = (now: number): void => {
      const delta = now - last;
      last = now;
      if (delta > 24)
        this.push({ kind: 'frame-drop', name: 'frame', start: now, duration: round(delta) });
      if (now < end) this.frameRaf = requestAnimationFrame(tick);
      else console.info('[perf] frame capture done — __atriumPerf.export() to download');
    };
    this.frameRaf = requestAnimationFrame(tick);
    console.info(`[perf] capturing dropped frames for ${ms}ms — scroll the thread now`);
  }

  summary(): Record<string, unknown> {
    const by = (k: PerfKind): number[] =>
      this.records
        .filter((r) => r.kind === k)
        .map((r) => r.duration)
        .sort((a, b) => a - b);
    const lt = by('longtask');
    const ix = by('interaction');
    const fd = by('frame-drop');
    const worstInteractions = this.records
      .filter((r) => r.kind === 'interaction')
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 8)
      .map((r) => ({ name: r.name, duration: round(r.duration), target: r.detail?.target }));
    const switches = this.records
      .filter((r) => r.kind === 'measure')
      .map((r) => ({ name: r.name, duration: round(r.duration) }));
    return {
      longtask: {
        count: lt.length,
        total: round(lt.reduce((a, b) => a + b, 0)),
        max: percentile(lt, 100),
        p95: percentile(lt, 95),
      },
      interaction: {
        count: ix.length,
        max: percentile(ix, 100),
        p95: percentile(ix, 95),
        worst: worstInteractions,
      },
      frameDrops: { count: fd.length, max: percentile(fd, 100), p95: percentile(fd, 95) },
      threadSwitches: switches,
    };
  }

  clear(): void {
    this.records = [];
    console.info('[perf] cleared');
  }

  export(): void {
    const payload = {
      meta: {
        timeOrigin: performance.timeOrigin,
        userAgent: navigator.userAgent,
        capturedAt: new Date().toISOString(),
        records: this.records.length,
      },
      summary: this.summary(),
      records: this.records,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atrium-perf-${this.records.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.info('[perf] exported', this.summary());
  }
}

export const perf = new PerfRecorder();

if (import.meta.env.DEV) {
  perf.install();
  (window as unknown as { __atriumPerf?: PerfRecorder }).__atriumPerf = perf;
  console.info(
    '[perf] recorder armed: reproduce, then __atriumPerf.export(). __atriumPerf.frames(8000) before a scroll test.',
  );
}
