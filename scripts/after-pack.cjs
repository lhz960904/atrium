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
 * Sign the nested Computer Use helper BEFORE electron-builder signs the app.
 * electron-builder doesn't deep-sign extraResources, but the app-level signature
 * that follows *seals* them — so signing the helper here (hardened, timestamped
 * Developer ID) means the seal, notarization, and staple electron-builder does
 * afterward are all consistent. Doing this in afterSign instead breaks the app's
 * resource seal (the helper changed after the app was sealed) and, once re-sealed,
 * breaks the staple ticket (prepared against the pre-afterSign signature).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!hasSigningIdentity()) {
    console.log('afterPack: no signing identity — leaving the helper as built (fork build).');
    return;
  }
  const helper = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    HELPER_REL,
  );
  console.log(`afterPack: signing helper at ${helper}`);
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
  execFileSync('codesign', ['--verify', '--strict', '--verbose=2', helper], { stdio: 'inherit' });
};
