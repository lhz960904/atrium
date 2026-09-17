import { expect, test } from 'bun:test';
import { join } from 'node:path';

// Other suites replace Electron with different partial exports. Bun caches
// module mock export shapes, so these integration cases need their own host.
// The child still runs real pi loops and SQLite sessions, not a mocked runner.
test.each(['runner', 'execute-run'])('%s lifecycle integration', async (name) => {
  const child = Bun.spawn([process.execPath, 'test', join(import.meta.dir, `${name}.cases.ts`)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${name} integration failed:\n${stdout}\n${stderr}`);
  expect(exitCode).toBe(0);
});
