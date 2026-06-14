/**
 * Dev-only JS self-profiler. Samples the main-thread call stack at a fixed
 * interval — it keeps sampling even while a long synchronous task freezes the
 * UI, so the captured stacks reveal exactly what's blocking.
 *
 * Captures ONLY stack samples (no screenshots / DOM events), so it stays small
 * and parses fine for long captures. Needs the `Document-Policy: js-profiling`
 * response header (injected by the main process in dev). Drives the Perf HUD;
 * also exposed as `window.__atriumProfile` for console use.
 */

import { analyzeTrace, type ProfilerTrace } from './perf-analysis';

type JSProfiler = { stop: () => Promise<ProfilerTrace>; stopped: boolean };
type ProfilerCtor = new (opts: { sampleInterval: number; maxBufferSize: number }) => JSProfiler;

export function profilerAvailable(): boolean {
  return typeof (window as unknown as { Profiler?: ProfilerCtor }).Profiler === 'function';
}

export function downloadTrace(trace: ProfilerTrace): void {
  const json = JSON.stringify({ summary: analyzeTrace(trace), trace });
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `atrium-jsprofile-${trace.samples.length}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

class JsProfilerHandle {
  private active: JSProfiler | null = null;

  get running(): boolean {
    return this.active != null && !this.active.stopped;
  }

  start(sampleIntervalMs = 10): boolean {
    const Ctor = (window as unknown as { Profiler?: ProfilerCtor }).Profiler;
    if (!Ctor) {
      console.warn(
        '[profile] window.Profiler unavailable — Document-Policy: js-profiling not set (restart dev).',
      );
      return false;
    }
    if (this.running) return true;
    try {
      this.active = new Ctor({ sampleInterval: sampleIntervalMs, maxBufferSize: 300000 });
      return true;
    } catch (err) {
      console.warn('[profile] failed to start', err);
      return false;
    }
  }

  async stop(): Promise<ProfilerTrace | null> {
    if (!this.active || this.active.stopped) return null;
    const trace = await this.active.stop();
    this.active = null;
    return trace;
  }
}

export const jsProfiler = new JsProfilerHandle();

if (import.meta.env.DEV) {
  const bridge = {
    start: () => jsProfiler.start(),
    stop: async () => {
      const trace = await jsProfiler.stop();
      if (!trace) {
        console.warn('[profile] not running');
        return;
      }
      console.table(analyzeTrace(trace).components);
      downloadTrace(trace);
    },
  };
  (window as unknown as { __atriumProfile?: typeof bridge }).__atriumProfile = bridge;
}
