#!/usr/bin/env bun
/**
 * Refresh the vendored models.dev snapshot (the offline fallback baked into the
 * build). Runtime freshness comes from the live CDN fetch in agent/models/
 * catalog.ts — this only re-bakes the floor. Run when shipping a release:
 *   bun run sync:models
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'https://models.dev/api.json';
const OUT = join(
  import.meta.dir,
  '..',
  'src',
  'main',
  'agent',
  'models',
  'models-dev.snapshot.json',
);

const res = await fetch(URL, { headers: { 'User-Agent': 'atrium' } });
if (!res.ok) {
  console.error(`models.dev fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const text = await res.text();
const data = JSON.parse(text);
const providers = Object.keys(data).length;
writeFileSync(OUT, text);
console.log(
  `synced models.dev snapshot: ${providers} providers, ${(text.length / 1e6).toFixed(1)}MB`,
);
