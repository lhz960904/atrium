import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '../../log';
import snapshotData from './litellm.snapshot.json';
import { capabilitiesFrom, maxContextTokensFrom } from './lookup';
import type { ModelCapabilities, ModelsCatalog } from './types';

const log = createLogger('models');

/**
 * Per-model capability data (context window, vision, tool-call, image output, …)
 * sourced from litellm's model catalog. Three-tier like opencode: a build-time
 * bundled snapshot is the offline floor, a disk cache is the warm copy, and a
 * background fetch keeps it fresh. Lookups always hit in-memory state, so call
 * sites never await IO and never fail — a cold/offline app still answers from
 * the snapshot.
 */

const MODELS_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_TTL_MS = 5 * 60_000;
const REFRESH_INTERVAL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

const SNAPSHOT = snapshotData as unknown as ModelsCatalog;
let catalog: ModelsCatalog = SNAPSHOT;

function cacheFile(): string {
  return join(app.getPath('userData'), 'cache', 'litellm-models.json');
}

// litellm's file is a flat map keyed by model id with a `sample_spec` sentinel
// documenting the schema — its presence is a reliable shape check.
function isCatalogShaped(data: unknown): data is ModelsCatalog {
  return typeof data === 'object' && data !== null && 'sample_spec' in data;
}

/** Load the warm disk copy if present; otherwise stay on the bundled snapshot. */
export function populateModelCatalog(): void {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    if (isCatalogShaped(parsed)) catalog = parsed;
  } catch {
    // no cache yet (or unreadable) — the snapshot already covers us
  }
}

function cacheAgeMs(): number {
  try {
    return Date.now() - statSync(cacheFile()).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function fetchAndCache(): Promise<void> {
  const res = await fetch(MODELS_URL, {
    headers: { 'User-Agent': 'atrium' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`litellm catalog HTTP ${res.status}`);
  const text = await res.text();
  const parsed = JSON.parse(text);
  if (!isCatalogShaped(parsed)) throw new Error('litellm catalog returned an unexpected shape');
  const file = cacheFile();
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
  catalog = parsed;
}

/**
 * Refresh from the CDN now (unless the disk copy is fresh), then on an interval.
 * Failures are swallowed — the app keeps serving cached/snapshot data. Call once
 * after populate at startup.
 */
export function startModelCatalogRefresh(): void {
  const tick = async () => {
    if (cacheAgeMs() < CACHE_TTL_MS) return;
    try {
      await fetchAndCache();
    } catch (err) {
      log.warn('litellm catalog refresh failed:', (err as Error).message);
    }
  };
  void tick();
  setInterval(() => void tick(), REFRESH_INTERVAL_MS).unref();
}

export function maxContextTokens(modelId: string): number {
  return maxContextTokensFrom(catalog, modelId);
}

export function modelCapabilities(modelId: string): ModelCapabilities {
  return capabilitiesFrom(catalog, modelId);
}
