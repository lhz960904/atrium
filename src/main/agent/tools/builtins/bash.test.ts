import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import { BackgroundShells, type ShellProc } from '../../sandbox/background-shells';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { bashTool } from './bash';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    writeFile: async () => ({ bytes: 0 }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws', db: {} as Db };
}

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant here
const opts = {} as any;

test('returns output on success', async () => {
  const t = bashTool(ctx({ exec: async () => ({ output: 'hello\n', exitCode: 0 }) }));
  expect(await t.execute?.({ description: 'x', command: 'echo hello' }, opts)).toBe('hello');
});

test('reports empty output as (no output)', async () => {
  const t = bashTool(ctx({ exec: async () => ({ output: '   \n', exitCode: 0 }) }));
  expect(await t.execute?.({ description: 'x', command: 'true' }, opts)).toBe('(no output)');
});

test('appends a non-zero exit code', async () => {
  const t = bashTool(ctx({ exec: async () => ({ output: 'boom', exitCode: 2 }) }));
  const out = await t.execute?.({ description: 'x', command: 'false' }, opts);
  expect(out).toBe('boom\nExit Code: 2');
});

test('middle-truncates very long output', async () => {
  const big = 'a'.repeat(30_000);
  const t = bashTool(ctx({ exec: async () => ({ output: big, exitCode: 0 }) }));
  const out = (await t.execute?.({ description: 'x', command: 'cat big' }, opts)) as string;
  expect(out.length).toBeLessThan(big.length);
  expect(out).toContain('middle truncated');
});

test('surfaces exec errors as an Error string', async () => {
  const t = bashTool(
    ctx({
      exec: async () => {
        throw new Error('pty spawn failed');
      },
    }),
  );
  expect(await t.execute?.({ description: 'x', command: 'x' }, opts)).toBe(
    'Error: pty spawn failed',
  );
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
  // biome-ignore lint/suspicious/noExplicitAny: only abortSignal matters here
  await t.execute?.({ description: 'x', command: 'echo' }, { abortSignal: ac.signal } as any);
  expect(received).toBe(ac.signal);
});

const noopProc: ShellProc = { onData() {}, onExit() {}, kill() {} };

test('run_in_background starts a shell via the registry and returns its id', async () => {
  const bgShells = new BackgroundShells(() => noopProc);
  const t = bashTool({ ...ctx({}), bgShells });
  const out = await t.execute?.(
    { description: 'x', command: 'npm run dev', run_in_background: true },
    opts,
  );
  expect(out).toBe(
    'Started background shell bash_1. Read its output with bash_output and stop it with kill_shell.',
  );
});

test('run_in_background errors when no registry is available', async () => {
  const t = bashTool(ctx({}));
  const out = await t.execute?.(
    { description: 'x', command: 'npm run dev', run_in_background: true },
    opts,
  );
  expect(out).toContain('unavailable');
});
