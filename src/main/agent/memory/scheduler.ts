import type { LanguageModel } from 'ai';
import { createLogger } from '../../log';
import { acquireLock, releaseLock } from './lock';
import { DREAM_SCAN_INTERVAL_MS, listMemoryDirs } from './paths';
import { shouldConsolidate } from './state';

const log = createLogger('memory');

export type DreamScheduler = {
  runDream: (dir: string, model: LanguageModel) => Promise<void>;
  /** The model to consolidate with; null when none is configured → skip the sweep. */
  model: () => LanguageModel | null;
  /** Dirs to sweep; defaults to every memory dir on disk. Injectable for tests. */
  listDirs?: () => Promise<string[]>;
};

/** One pass: consolidate every memory dir that's due, each guarded by the lock. */
export async function dreamSweep(opts: DreamScheduler, now: number): Promise<void> {
  const model = opts.model();
  if (!model) return;
  const dirs = await (opts.listDirs ?? listMemoryDirs)();
  for (const dir of dirs) {
    if (!(await shouldConsolidate(dir, now))) continue;
    if (!(await acquireLock(dir, now))) continue;
    void opts
      .runDream(dir, model)
      .catch((err) => log.error(`dream failed: ${dir}`, err))
      .finally(() => releaseLock(dir));
  }
}

/** Start the background sweep: once on app-ready, then on an interval. */
export function startDreamScheduler(opts: DreamScheduler): void {
  const { app } = require('electron') as typeof import('electron');
  const tick = () =>
    dreamSweep(opts, Date.now()).catch((err) => log.error('dream sweep failed', err));
  app.whenReady().then(tick);
  setInterval(tick, DREAM_SCAN_INTERVAL_MS);
}
