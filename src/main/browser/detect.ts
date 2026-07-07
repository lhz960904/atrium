import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The official "Playwright Extension" Chrome Web Store id. */
const PLAYWRIGHT_EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';

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

/** Chrome's user-data root (where per-profile dirs live), by platform. */
function chromeUserDataDir(): string | null {
  const home = homedir();
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA;
    return base ? join(base, 'Google', 'Chrome', 'User Data') : null;
  }
  return join(home, '.config', 'google-chrome');
}

/**
 * Whether the Playwright Extension is installed in any Chrome profile. Chrome
 * unpacks each extension to `<profile>/Extensions/<id>/`, so we scan the profile
 * dirs for that id — a cheap on-disk check, no Chrome APIs. Detecting the
 * install (not just a live bridge) is what lets the setup step confirm itself
 * and unlock the connect step.
 */
export function isPlaywrightExtensionInstalled(): boolean {
  const root = chromeUserDataDir();
  if (!root) return false;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return false;
  }
  // "Default", "Profile 1", "Profile 2", … each hold their own Extensions dir.
  return entries.some(
    (profile) =>
      (profile === 'Default' || profile.startsWith('Profile ')) &&
      existsSync(join(root, profile, 'Extensions', PLAYWRIGHT_EXTENSION_ID)),
  );
}
