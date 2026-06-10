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
