import { join } from 'node:path';

const APP_BUNDLE = 'Atrium Computer Use.app';
const EXECUTABLE = `${APP_BUNDLE}/Contents/MacOS/AtriumComputerUse`;

// The signed helper bundle ships in Resources when packaged; in dev it's the
// locally built one under the repo (native/computer-use-helper/build). Lazy
// require keeps this module loadable under bun (mirrors the skills resolver).
export function resolveHelperBinaryPath(): string {
  const { app } = require('electron') as typeof import('electron');
  return app.isPackaged
    ? join(process.resourcesPath, EXECUTABLE)
    : join(app.getAppPath(), 'native', 'computer-use-helper', 'build', EXECUTABLE);
}
