import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Whether Google Chrome is installed. The browser feature drives Chrome
 * (playwright-mcp defaults to its "chrome" channel), so without it the public
 * browser can't launch. A cheap, synchronous probe of the standard install
 * locations — it never launches Chrome. Re-checked on demand so installing
 * Chrome is picked up without a hardcoded snapshot.
 */
export function isChromeInstalled(): boolean {
  if (process.platform === 'darwin') {
    return (
      existsSync('/Applications/Google Chrome.app') ||
      existsSync(join(homedir(), 'Applications', 'Google Chrome.app'))
    );
  }
  if (process.platform === 'win32') {
    const bases = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter((b): b is string => Boolean(b));
    return bases.some((base) =>
      existsSync(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    );
  }
  // Linux and the rest: look for a Chrome binary on PATH.
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chrome']) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' });
      return true;
    } catch {
      // not this name — try the next
    }
  }
  return false;
}
