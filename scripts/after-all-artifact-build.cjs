const { execFileSync } = require('node:child_process');

const IDENTITY = process.env.CSC_NAME || 'Developer ID Application: Lu Liu (43PH2NJ5C4)';

/**
 * Sign, notarize + staple the .dmg itself.
 *
 * electron-builder's `notarize: true` notarizes and staples the *app*, and the
 * dmg then ships that stapled app — but the dmg *container* is left unsigned and
 * un-notarized (spctl rejects it: "no usable signature"). That's invisible
 * locally (a self-built dmg has no quarantine flag) but bites a *downloader*: the
 * dmg picks up com.apple.quarantine from the browser, and Gatekeeper blocks it.
 *
 * So once the dmg is built, sign it with Developer ID, submit it to Apple's
 * notary, and staple the ticket — a stapled-but-unsigned dmg is still
 * spctl-rejected, so the signature is required, not optional. The zip target is
 * deliberately skipped — it feeds electron-updater, which checks the notarized
 * app inside, not the container. No creds (fork build, Windows/Linux) → skip
 * cleanly, same as electron-builder's own notarize step.
 */
exports.default = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return [];

  const dmgs = (buildResult.artifactPaths ?? []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) return [];

  const profile = process.env.APPLE_KEYCHAIN_PROFILE;
  const appleId = process.env.APPLE_ID;
  const appPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const credArgs = profile
    ? ['--keychain-profile', profile]
    : appleId && appPassword && teamId
      ? ['--apple-id', appleId, '--password', appPassword, '--team-id', teamId]
      : null;
  if (!credArgs) {
    console.log(
      'afterAllArtifactBuild: no notarization credentials — leaving the dmg un-notarized.',
    );
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`afterAllArtifactBuild: signing + notarizing dmg ${dmg}`);
    execFileSync('codesign', ['--force', '--timestamp', '--sign', IDENTITY, dmg], {
      stdio: 'inherit',
    });
    execFileSync('xcrun', ['notarytool', 'submit', dmg, '--wait', ...credArgs], {
      stdio: 'inherit',
    });
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
  }
  return [];
};
