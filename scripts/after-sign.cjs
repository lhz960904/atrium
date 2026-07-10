const { execFileSync } = require('node:child_process');
const path = require('node:path');

const IDENTITY = process.env.CSC_NAME || 'Developer ID Application: Lu Liu (43PH2NJ5C4)';
const HELPER_REL = 'Contents/Resources/Atrium Computer Use.app';
const ENTITLEMENTS = path.join(
  __dirname,
  '..',
  'native',
  'computer-use-helper',
  'entitlements.plist',
);
const MAC_ENTITLEMENTS = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');

// True when a Developer ID Application identity is reachable (login keychain
// locally, the imported CSC_LINK keychain in CI). False on forks without
// secrets — where electron-builder also skips signing, so we skip too.
function hasSigningIdentity() {
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    });
    return out.includes('Developer ID Application');
  } catch {
    return false;
  }
}

/**
 * electron-builder signs the app but not nested extraResources, and the helper's
 * dev signature has no secure timestamp — notarization requires one. Re-sign the
 * helper here: this runs after the app is signed and before notarization, so a
 * hardened, timestamped Developer ID signature is in place when the whole bundle
 * is submitted.
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!hasSigningIdentity()) {
    console.log('afterSign: no signing identity — leaving the helper unsigned (fork build).');
    return;
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const helper = path.join(appPath, HELPER_REL);
  console.log(`afterSign: re-signing helper at ${helper}`);
  execFileSync(
    'codesign',
    [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      ENTITLEMENTS,
      '--sign',
      IDENTITY,
      helper,
    ],
    { stdio: 'inherit' },
  );
  // Re-signing the helper changed Contents/Resources, so the app's resource seal
  // no longer matches. Re-sign the app envelope — NOT --deep, so the nested
  // Electron frameworks keep their own signatures — to re-seal over the updated
  // helper. A full --deep verify then confirms the whole tree is consistent.
  console.log('afterSign: re-sealing the app envelope');
  execFileSync(
    'codesign',
    [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      MAC_ENTITLEMENTS,
      '--sign',
      IDENTITY,
      appPath,
    ],
    { stdio: 'inherit' },
  );
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
