import { createHash } from 'node:crypto';
import { cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Snapshot lives in the OS temp dir, not beside the memory dir, so it never gets
// picked up by listMemoryDirs (which would otherwise try to consolidate a backup).
function backupPath(dir: string): string {
  const id = createHash('sha256').update(dir).digest('hex').slice(0, 16);
  return join(tmpdir(), `atrium-dream-bak-${id}`);
}

/** Copy the memory dir aside so a failed dream can be fully rolled back. */
export async function snapshot(dir: string): Promise<void> {
  const bak = backupPath(dir);
  await rm(bak, { recursive: true, force: true });
  await cp(dir, bak, { recursive: true });
}

/** Restore the memory dir from the snapshot, discarding the dream's changes. */
export async function rollback(dir: string): Promise<void> {
  const bak = backupPath(dir);
  await rm(dir, { recursive: true, force: true });
  await cp(bak, dir, { recursive: true });
  await rm(bak, { recursive: true, force: true });
}

/** Drop the snapshot after a successful dream. */
export async function clearSnapshot(dir: string): Promise<void> {
  await rm(backupPath(dir), { recursive: true, force: true });
}
