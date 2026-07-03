/**
 * Merge the arm64 and x64 `latest-mac.yml` manifests that electron-builder emits
 * on two separate native runners into one manifest listing both architectures'
 * files, so electron-updater on either Mac downloads the build matching its arch.
 *
 * Without this, whichever runner publishes last overwrites the other's
 * single-arch manifest on the GitHub Release, and half of users get a wrong-arch
 * or failed update. Run from release.yml after both mac builds finish.
 *
 *   node scripts/merge-mac-yml.cjs <arm64.yml> <x64.yml> <out.yml>
 *
 * CommonJS + require on purpose: CI installs only `yaml` into a temp dir and
 * points NODE_PATH at it (avoiding a full app-tree install just to combine two
 * small files), and NODE_PATH is honored for require but not for ESM imports.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { parse, stringify } = require('yaml');

const [armPath, x64Path, outPath] = process.argv.slice(2);
if (!armPath || !x64Path || !outPath) {
  console.error('usage: merge-mac-yml.cjs <arm64.yml> <x64.yml> <out.yml>');
  process.exit(1);
}

const arm = parse(readFileSync(armPath, 'utf8'));
const x64 = parse(readFileSync(x64Path, 'utf8'));

// Concatenate both file lists, de-duped by url. version / releaseDate are
// identical across the two, so keep arm64's scalar fields; the legacy top-level
// path / sha512 is only a fallback — modern electron-updater picks from files[]
// by matching the arch token in each url.
const seen = new Set();
const files = [...(arm.files ?? []), ...(x64.files ?? [])].filter((f) => {
  if (seen.has(f.url)) return false;
  seen.add(f.url);
  return true;
});

if (files.length === 0) {
  console.error('refusing to write an empty manifest: no files in either input');
  process.exit(1);
}

// Serialize as YAML 1.1 to match how electron-updater reads it (js-yaml, 1.1):
// that schema resolves a bare ISO timestamp to a Date, so releaseDate must stay
// quoted to survive as a string — 1.1 stringify quotes it automatically.
writeFileSync(outPath, stringify({ ...arm, files }, { version: '1.1' }));
console.log(`merged ${files.length} files -> ${outPath}`);
for (const f of files) console.log(`  ${f.url}`);
