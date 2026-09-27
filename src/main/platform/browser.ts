import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** The official "Playwright Extension" Chrome Web Store id. */
export const PLAYWRIGHT_EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';

const CHROME_BINARIES = ['google-chrome', 'google-chrome-stable', 'chrome'];

/**
 * Whether PATH holds an executable of this name — the lookup `which` performs,
 * done in-process. Shelling out cost a fork per candidate name on a probe the
 * settings UI polls, and left us reporting "not installed" on the systems that
 * ship no `which` at all.
 */
function onPath(name: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      // not this directory — try the next
    }
  }
  return false;
}

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
  return CHROME_BINARIES.some(onPath);
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
