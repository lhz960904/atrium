/*
 * Builds images/showcase.svg — the auto-cycling screenshot carousel embedded in
 * the READMEs. GitHub strips scripts and styles from rendered markdown, so the
 * carousel is a plain SVG whose frames cross-fade via SMIL opacity animations.
 * Frames are resampled to a fixed width (needs macOS `sips`) before being
 * inlined as base64, keeping the README payload small.
 *
 * Usage: bun scripts/make-showcase.ts images/agent-trace.png images/providers.png ...
 * Frames appear in argument order; output goes to images/showcase.svg.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const FRAME_WIDTH = 1400;
const HOLD_SECONDS = 3.5;
const FADE_SECONDS = 0.7;
const OUTPUT = 'images/showcase.svg';

const inputs = Bun.argv.slice(2);
if (inputs.length < 2) {
  console.error('usage: bun scripts/make-showcase.ts <image.png> <image.png> [...]');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'showcase-'));
const frames: string[] = [];
for (const input of inputs) {
  const resampled = join(workDir, basename(input));
  const sips = Bun.spawnSync([
    'sips',
    '--resampleWidth',
    String(FRAME_WIDTH),
    input,
    '--out',
    resampled,
  ]);
  if (sips.exitCode !== 0) {
    console.error(`sips failed for ${input}: ${sips.stderr.toString()}`);
    process.exit(1);
  }
  frames.push(resampled);
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const first = new Uint8Array(await Bun.file(frames[0]).arrayBuffer());
const { width, height } = pngSize(first);

const slot = HOLD_SECONDS + FADE_SECONDS;
const total = frames.length * slot;
const asKeyTime = (t: number) => (t / total).toFixed(4);

let images = '';
for (let i = 0; i < frames.length; i++) {
  const b64 = Buffer.from(await Bun.file(frames[i]).arrayBuffer()).toString('base64');
  let times: number[];
  let values: number[];
  if (i === 0) {
    // The first frame starts visible and fades back in at the tail of the
    // loop, overlapping the last frame's fade-out for a seamless wrap.
    times = [0, slot - FADE_SECONDS, slot, total - FADE_SECONDS, total];
    values = [1, 1, 0, 0, 1];
  } else {
    const start = i * slot;
    const end = start + slot;
    times = [0, start - FADE_SECONDS, start, end - FADE_SECONDS, end];
    values = [0, 0, 1, 1, 0];
    if (end < total) {
      times.push(total);
      values.push(0);
    }
  }
  images += `  <image href="data:image/png;base64,${b64}" x="0" y="0" width="${width}" height="${height}">
    <animate attributeName="opacity" dur="${total}s" repeatCount="indefinite" values="${values.join(';')}" keyTimes="${times.map(asKeyTime).join(';')}" calcMode="linear"/>
  </image>\n`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
${images}</svg>\n`;
await Bun.write(OUTPUT, svg);
console.log(
  `${OUTPUT}: ${frames.length} frames, ${total}s loop, ${(svg.length / 1024 / 1024).toFixed(2)} MB`,
);
