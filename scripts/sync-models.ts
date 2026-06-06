#!/usr/bin/env bun
/**
 * Refresh the vendored litellm model catalog snapshot (the offline fallback
 * baked into the build). Runtime freshness comes from the live fetch in
 * agent/models/catalog.ts — this only re-bakes the floor. Run when shipping a
 * release:
 *   bun run sync:models
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OUT = join(import.meta.dir, '..', 'src', 'main', 'agent', 'models', 'litellm.snapshot.json');

const res = await fetch(URL, { headers: { 'User-Agent': 'atrium' } });
if (!res.ok) {
  console.error(`litellm catalog fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const text = await res.text();
const models = Object.keys(JSON.parse(text)).length;
writeFileSync(OUT, text);
console.log(
  `synced litellm catalog snapshot: ${models} models, ${(text.length / 1e6).toFixed(1)}MB`,
);
