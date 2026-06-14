/**
 * Pure analysis over a JS Self-Profiling trace — the in-app version of the
 * scripts used to crack the streaming-freeze: rank our own components by the
 * time their render subtree was on the stack, and measure the longest
 * contiguous main-thread block (the "freeze" proxy). No DOM/React deps so it's
 * unit-testable and reusable.
 */

export type ProfilerFrame = { name?: string; resourceId?: number; line?: number; column?: number };
export type ProfilerStack = { frameId: number; parentId?: number };
export type ProfilerSample = { timestamp: number; stackId?: number };
export type ProfilerTrace = {
  resources: string[];
  frames: ProfilerFrame[];
  stacks: ProfilerStack[];
  samples: ProfilerSample[];
};

export type ComponentStat = {
  frameId: number;
  name: string;
  file: string;
  line: number;
  inclusiveMs: number;
};
export type LeafStat = { label: string; ms: number };
export type TraceAnalysis = {
  samples: number;
  wallMs: number;
  activeMs: number;
  /** Longest run of consecutive busy samples — what the user feels as a freeze. */
  longestBlockMs: number;
  components: ComponentStat[];
};

// A gap larger than this between samples is treated as idle (the profiler was
// paused / nothing ran), not a single blocking task — don't fold it into busy time.
const IDLE_GAP_MS = 100;

function resourceUrl(trace: ProfilerTrace, frameId: number): string {
  const f = trace.frames[frameId];
  return f?.resourceId != null ? (trace.resources[f.resourceId] ?? '') : '';
}

/** Our own renderer source, excluding deps and the dev-tools themselves. */
function isAppFrame(trace: ProfilerTrace, frameId: number): boolean {
  const url = resourceUrl(trace, frameId);
  return url.includes('/src/') && !url.includes('node_modules') && !url.includes('/lib/dev/');
}

export function frameLabel(trace: ProfilerTrace, frameId: number): string {
  const f = trace.frames[frameId];
  if (!f) return '?';
  const url = resourceUrl(trace, frameId).replace(/\?.*$/, '');
  const file = url ? url.split('/').slice(-1)[0] : '';
  return `${f.name || '(anonymous)'}${file ? ` @${file}:${f.line ?? 0}` : ''}`;
}

function fileLine(trace: ProfilerTrace, frameId: number): { file: string; line: number } {
  const f = trace.frames[frameId];
  const url = resourceUrl(trace, frameId).replace(/\?.*$/, '');
  return { file: url ? url.split('/').slice(-1)[0] : '', line: f?.line ?? 0 };
}

/** Frame ids from leaf → root for a stack id. */
function chainOf(trace: ProfilerTrace, stackId: number): number[] {
  const out: number[] = [];
  let s: number | undefined = stackId;
  let guard = 0;
  while (s != null && guard++ < 2000) {
    const st = trace.stacks[s];
    if (!st) break;
    out.push(st.frameId);
    s = st.parentId;
  }
  return out;
}

function durations(trace: ProfilerTrace): number[] {
  const s = trace.samples;
  const d = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) {
    d[i] = (s[i + 1]?.timestamp ?? s[i].timestamp) - s[i].timestamp;
  }
  return d;
}

export function analyzeTrace(trace: ProfilerTrace): TraceAnalysis {
  const s = trace.samples;
  const dur = durations(trace);
  const incl = new Map<number, number>();
  let activeMs = 0;
  let run = 0;
  let longestBlockMs = 0;

  for (let i = 0; i < s.length; i++) {
    const ms = dur[i];
    const busy = s[i].stackId != null && ms > 0 && ms < IDLE_GAP_MS;
    if (busy) {
      activeMs += ms;
      run += ms;
      if (run > longestBlockMs) longestBlockMs = run;
      for (const fid of new Set(chainOf(trace, s[i].stackId as number))) {
        incl.set(fid, (incl.get(fid) ?? 0) + ms);
      }
    } else {
      run = 0;
    }
  }

  const components: ComponentStat[] = [...incl.entries()]
    .filter(([fid]) => isAppFrame(trace, fid))
    .map(([frameId, inclusiveMs]) => {
      const f = trace.frames[frameId];
      return { frameId, name: f?.name || '(anonymous)', ...fileLine(trace, frameId), inclusiveMs };
    })
    .sort((a, b) => b.inclusiveMs - a.inclusiveMs)
    .slice(0, 15);

  const wallMs = s.length > 1 ? s[s.length - 1].timestamp - s[0].timestamp : 0;
  return { samples: s.length, wallMs, activeMs, longestBlockMs, components };
}

/** What burned CPU *inside* a given component — top leaf frames among samples
 *  whose stack passes through it. Drives the expandable per-component breakdown. */
export function leavesUnder(trace: ProfilerTrace, frameId: number): LeafStat[] {
  const dur = durations(trace);
  const self = new Map<number, number>();
  for (let i = 0; i < trace.samples.length; i++) {
    const sid = trace.samples[i].stackId;
    if (sid == null) continue;
    const ms = dur[i];
    if (ms <= 0 || ms >= IDLE_GAP_MS) continue;
    const chain = chainOf(trace, sid);
    if (!chain.includes(frameId)) continue;
    const leaf = chain[0];
    self.set(leaf, (self.get(leaf) ?? 0) + ms);
  }
  return [...self.entries()]
    .map(([leaf, ms]) => ({ label: frameLabel(trace, leaf), ms: Math.round(ms) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);
}
