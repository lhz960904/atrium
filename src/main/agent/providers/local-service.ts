/**
 * Ollama's API surface, in one place — endpoint paths and response shapes
 * belong together, mirroring how model-fetcher.ts owns the cloud protocols'
 * listing endpoints. When another local service lands (LM Studio…), it gets
 * its own functions here behind a protocol discriminator, not a path config.
 */

export type LocalServiceStatus = { running: boolean; version?: string };

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

/**
 * Liveness probe via /api/version. Short timeout: the common failure is
 * "service not started", where localhost refuses instantly — but a wedged
 * service shouldn't hang the settings UI either. Never throws; "can't reach"
 * IS the answer.
 */
export async function pingOllama(baseUrl: string, timeoutMs = 1500): Promise<LocalServiceStatus> {
  try {
    const res = await fetch(`${trimSlash(baseUrl)}/api/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { running: false };
    const body = (await res.json().catch(() => ({}))) as { version?: unknown };
    return {
      running: true,
      ...(typeof body.version === 'string' ? { version: body.version } : {}),
    };
  } catch {
    return { running: false };
  }
}

const REGISTRY_URL = 'https://registry.ollama.ai';

/** exists=null means the registry couldn't be reached — unknown, not absent. */
export type ModelProbe = { exists: boolean | null; sizeBytes?: number };

/**
 * Check a model name against the public registry and read its download size
 * from the manifest (sum of layer blobs). The registry has no search API
 * (ollama/ollama#9142), but manifest probing is official Docker-registry
 * surface — it's what powers the validating autocomplete and keeps curated
 * sizes from going stale in code.
 */
export async function probeOllamaRegistry(model: string): Promise<ModelProbe> {
  const colon = model.lastIndexOf(':');
  const name = colon === -1 ? model : model.slice(0, colon);
  const tag = colon === -1 ? 'latest' : model.slice(colon + 1);
  // Un-namespaced names live under library/ (qwen3 → library/qwen3).
  const path = name.includes('/') ? name : `library/${name}`;
  const res = await fetch(`${REGISTRY_URL}/v2/${path}/manifests/${encodeURIComponent(tag)}`, {
    headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { layers?: Array<{ size?: number }> };
  const sizeBytes = (body.layers ?? []).reduce((sum, layer) => sum + (layer.size ?? 0), 0);
  return { exists: true, sizeBytes };
}

// A published model:tag's manifest is effectively immutable, so resolved
// probes cache for the app's lifetime; registry failures stay uncached.
const probeCache = new Map<string, ModelProbe>();

export async function probeOllamaRegistryCached(model: string): Promise<ModelProbe> {
  const hit = probeCache.get(model);
  if (hit) return hit;
  const result = await probeOllamaRegistry(model);
  probeCache.set(model, result);
  return result;
}

export type PullProgress = { status: string; completed?: number; total?: number };

/**
 * Download a model via the native /api/pull, which streams NDJSON progress
 * lines ({status, completed?, total?}; an {error} line means failure). No
 * request timeout — a multi-GB pull legitimately runs for many minutes; the
 * stream ending is the completion signal.
 */
export async function pullOllamaModel(
  baseUrl: string,
  model: string,
  onProgress: (p: PullProgress) => void,
): Promise<void> {
  const res = await fetch(`${trimSlash(baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
    );
  }

  const handleLine = (line: string): void => {
    if (!line.trim()) return;
    let parsed: { status?: string; completed?: number; total?: number; error?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // tolerate a torn/non-JSON line rather than failing the pull
    }
    if (parsed.error) throw new Error(parsed.error);
    onProgress({ status: parsed.status ?? '', completed: parsed.completed, total: parsed.total });
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  handleLine(buffer);
}

/**
 * Locally installed models via the native /api/tags — richer than the
 * openai-compatible /v1/models and the canonical "what's pulled" source.
 */
export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${trimSlash(baseUrl)}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
    );
  }
  const body = (await res.json()) as { models?: Array<{ name?: string }> };
  return (body.models ?? []).map((m) => m.name ?? '').filter((name) => name.length > 0);
}
