import type { CloudApiProtocol } from './manifest';

/**
 * Fetch the available model id list from a cloud provider's `/models`-style
 * endpoint. Each protocol has its own request shape and response shape, but
 * the caller only cares about the resulting `string[]`.
 *
 * Errors are surfaced verbatim with a short prefix so the renderer can
 * show the user what actually went wrong (auth, network, bad endpoint).
 */
export async function fetchModelIds(args: {
  protocol: CloudApiProtocol;
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const { protocol, baseUrl, apiKey } = args;
  const trimmedBase = baseUrl.replace(/\/+$/, '');

  if (protocol === 'anthropic') {
    return fetchAnthropic(trimmedBase, apiKey);
  }
  if (protocol === 'openai-compatible') {
    return fetchOpenAiCompatible(trimmedBase, apiKey);
  }
  return fetchGemini(trimmedBase, apiKey);
}

async function fetchAnthropic(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!res.ok) throw await httpError(res);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id ?? '').filter((id) => id.length > 0);
}

async function fetchOpenAiCompatible(baseUrl: string, apiKey: string): Promise<string[]> {
  // OpenAI lists at `/models`; users sometimes paste a base URL with or
  // without the `/v1` suffix, so we just append `/models` and trust the
  // upstream to 404 if wrong.
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw await httpError(res);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id ?? '').filter((id) => id.length > 0);
}

async function fetchGemini(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw await httpError(res);
  const body = (await res.json()) as { models?: Array<{ name?: string }> };
  return (
    (body.models ?? [])
      .map((m) => m.name ?? '')
      // Gemini returns "models/gemini-2.5-pro"; strip the prefix for parity
      // with the other protocols' bare ids.
      .map((name) => name.replace(/^models\//, ''))
      .filter((id) => id.length > 0)
  );
}

async function httpError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  const snippet = body.slice(0, 200);
  return new Error(`HTTP ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`);
}
