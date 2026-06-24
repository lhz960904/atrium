import type { LanguageModel } from 'ai';
import { createLogger } from '../../log';
import { acquireLock, releaseLock } from './lock';
import { listMemoryDirs } from './paths';
import { shouldConsolidate } from './state';

const log = createLogger('memory');
const DREAM_SCAN_INTERVAL_MS = 30 * 60_000; // background sweep period

export type DreamScheduler = {
  runDream: (dir: string, model: LanguageModel) => Promise<void>;
  /** The model to consolidate with; null when none is configured → skip the sweep. */
  model: () => LanguageModel | null;
  /** Dirs to sweep; defaults to every memory dir on disk. Injectable for tests. */
  listDirs?: () => Promise<string[]>;
};

/** One pass: consolidate every memory dir that's due, each guarded by the lock. */
export async function dreamSweep(opts: DreamScheduler, now: number): Promise<void> {
  const dirs = await (opts.listDirs ?? listMemoryDirs)();
  let model: LanguageModel | null = null;
  for (const dir of dirs) {
    if (!(await shouldConsolidate(dir, now))) continue;
    if (!(await acquireLock(dir, now))) continue;
    // Resolve the model only once a dir is actually due and locked. model()
    // decrypts the provider key, which reaches into the OS keychain; resolving it
    // up-front would prompt for keychain access on every idle sweep — including
    // the one that runs at app launch, when nothing needs consolidating.
    if (model === null) {
      model = opts.model();
      if (!model) {
        await releaseLock(dir);
        return;
      }
    }
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
