import type { Runner } from './runner';

/**
 * The process's runner, and how anything reaches it.
 *
 * Kept apart from `runner.ts` because this is imported by the layer above —
 * the routers and their tests — and that file pulls in the whole turn: tools,
 * the sandbox, Electron. A type import is erased, so this module costs its
 * callers nothing.
 *
 * One composition root for every turn; the renderer's calls and the scheduler
 * are both callers of the same one. It is held here rather than travelling
 * through a request context, which is for what varies per request.
 */
let instance: Runner | undefined;

export function openRunner(runner: Runner): void {
  instance = runner;
}

export function runner(): Runner {
  if (!instance) throw new Error('runner not initialized');
  return instance;
}

/** Stop the runner and forget it; whatever it was running is aborted. */
export async function closeRunner(): Promise<void> {
  const open = instance;
  instance = undefined;
  await open?.dispose();
}
