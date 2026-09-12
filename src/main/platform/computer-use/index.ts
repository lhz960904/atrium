import { ComputerUseHelper } from './helper';
import { resolveHelperBinaryPath } from './paths';

export { ComputerUseHelper, type HelperResponse } from './helper';

let instance: ComputerUseHelper | null = null;

/**
 * Lazily-started singleton: one helper process is shared across turns. macOS
 * only — callers guard on platform, since the signed helper binary only exists
 * there.
 */
export function getComputerUseHelper(): ComputerUseHelper {
  if (!instance) {
    instance = new ComputerUseHelper(resolveHelperBinaryPath());
  }
  return instance;
}

export function disposeComputerUseHelper(): void {
  instance?.dispose();
  instance = null;
}
