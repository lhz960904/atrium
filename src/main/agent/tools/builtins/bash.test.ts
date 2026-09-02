import { expect, test } from 'bun:test';
import { BackgroundShells, type ShellProc } from '../../sandbox/background-shells';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { bashTool } from './bash';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    readFileBytes: async () => new Uint8Array(),
    writeFile: async () => ({ bytes: 0 }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws', run: fakeRun() };
}

test('returns output on success', async () => {
  const t = bashTool(ctx({ exec: async () => ({ output: 'hello\n', exitCode: 0 }) }));
  expect(await runTool(t, { description: 'x', command: 'echo hello' })).toBe('hello');
});

test('reports empty output as (no output)', async () => {
  const t = bashTool(ctx({ exec: async () => ({ output: '   \n', exitCode: 0 }) }));
  expect(await runTool(t, { description: 'x', command: 'true' })).toBe('(no output)');
});

test('appends a non-zero exit code', async () => {
  const t = bashTool(ctx({ exec: async () => ({ output: 'boom', exitCode: 2 }) }));
  expect(await runTool(t, { description: 'x', command: 'false' })).toBe('boom\nExit Code: 2');
});

test('middle-truncates very long output', async () => {
  const big = 'a'.repeat(30_000);
  const t = bashTool(ctx({ exec: async () => ({ output: big, exitCode: 0 }) }));
  const out = await runTool(t, { description: 'x', command: 'cat big' });
  expect(out.length).toBeLessThan(big.length);
  expect(out).toContain('middle truncated');
});

test('lets exec errors surface as tool failures', async () => {
  const t = bashTool(
    ctx({
      exec: async () => {
        throw new Error('pty spawn failed');
      },
    }),
  );
  expect(runTool(t, { description: 'x', command: 'x' })).rejects.toThrow('pty spawn failed');
});

test('forwards the abort signal to sandbox.exec', async () => {
  const ac = new AbortController();
  let received: AbortSignal | undefined;
  const t = bashTool(
    ctx({
      exec: async (_command, o) => {
        received = o?.signal;
        return { output: 'ok', exitCode: 0 };
      },
    }),
  );
  await runTool(t, { description: 'x', command: 'echo' }, ac.signal);
  expect(received).toBe(ac.signal);
});

const noopProc: ShellProc = { onData() {}, onExit() {}, kill() {} };

test('run_in_background starts a shell via the registry and returns its id', async () => {
  const bgShells = new BackgroundShells(() => noopProc);
  const t = bashTool({ ...ctx({}), bgShells });
  const out = await runTool(t, {
    description: 'x',
    command: 'npm run dev',
    run_in_background: true,
  });
  expect(out).toBe(
    'Started background shell bash_1. Read its output with bash_output and stop it with kill_shell.',
  );
});

test('run_in_background fails when no registry is available', async () => {
  const t = bashTool(ctx({}));
  expect(
    runTool(t, { description: 'x', command: 'npm run dev', run_in_background: true }),
  ).rejects.toThrow('unavailable');
});
