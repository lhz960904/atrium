import { expect, test } from 'bun:test';
import { analyzeTrace, leavesUnder, type ProfilerTrace } from './perf-analysis';

// root → performWorkOnRoot (lib) → Foo (app) → render (lib leaf)
const trace: ProfilerTrace = {
  resources: [
    'http://localhost:5173/src/components/Foo.tsx',
    'http://localhost:5173/@fs/x/node_modules/.vite/deps/react-dom_client.js',
  ],
  frames: [
    { name: '(root)' },
    { name: 'performWorkOnRoot', resourceId: 1 },
    { name: 'Foo', resourceId: 0, line: 10 },
    { name: 'render', resourceId: 1, line: 99 },
  ],
  stacks: [
    { frameId: 0 },
    { frameId: 1, parentId: 0 },
    { frameId: 2, parentId: 1 },
    { frameId: 3, parentId: 2 },
  ],
  // three busy samples (a 30ms block), an idle break, then one more busy sample
  samples: [
    { timestamp: 0, stackId: 3 },
    { timestamp: 10, stackId: 3 },
    { timestamp: 20, stackId: 3 },
    { timestamp: 30 },
    { timestamp: 40, stackId: 3 },
    { timestamp: 50 },
  ],
};

test('longest block = longest contiguous busy run, not total', () => {
  expect(analyzeTrace(trace).longestBlockMs).toBe(30);
});

test('active time sums only busy samples', () => {
  expect(analyzeTrace(trace).activeMs).toBe(40);
});

test('ranks our components, excludes library frames', () => {
  const { components } = analyzeTrace(trace);
  expect(components).toHaveLength(1);
  expect(components[0]).toMatchObject({ name: 'Foo', file: 'Foo.tsx', line: 10, inclusiveMs: 40 });
});

test('wall time spans first to last sample', () => {
  expect(analyzeTrace(trace).wallMs).toBe(50);
});

test('leavesUnder attributes inner cost to the leaf frame', () => {
  const leaves = leavesUnder(trace, 2);
  expect(leaves[0]).toEqual({ label: 'render @react-dom_client.js:99', ms: 40 });
});
