import { afterEach, expect, test } from 'bun:test';
import {
  fetchOllamaModels,
  type PullProgress,
  pingOllama,
  probeOllamaRegistry,
  probeOllamaRegistryCached,
  pullOllamaModel,
} from './local-service';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'X',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response) as unknown as typeof fetch;
}

test('ping reports running with the service version', async () => {
  respond(200, { version: '0.9.2' });
  expect(await pingOllama('http://localhost:11434/')).toEqual({
    running: true,
    version: '0.9.2',
  });
});

test('ping treats refused connections and bad statuses as not running', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  expect(await pingOllama('http://localhost:11434')).toEqual({
    running: false,
  });

  respond(500, {});
  expect(await pingOllama('http://localhost:11434')).toEqual({
    running: false,
  });
});

test('ping tolerates a non-JSON health body', async () => {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as Response) as unknown as typeof fetch;
  expect(await pingOllama('http://localhost:11434')).toEqual({
    running: true,
  });
});

test('fetchOllamaModels lists installed model names from /api/tags', async () => {
  respond(200, { models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }, { name: '' }] });
  expect(await fetchOllamaModels('http://localhost:11434')).toEqual(['qwen3:8b', 'gemma3:4b']);
});

test('fetchOllamaModels surfaces HTTP failures', async () => {
  respond(404, { error: 'nope' });
  await expect(fetchOllamaModels('http://localhost:11434')).rejects.toThrow('HTTP 404');
});

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, statusText: 'OK', body: stream } as unknown as Response;
}

test('pullOllamaModel streams progress lines, including lines split across chunks', async () => {
  globalThis.fetch = (async () =>
    ndjsonResponse([
      '{"status":"pulling manifest"}\n{"status":"downloading","compl',
      'eted":50,"total":100}\n',
      '{"status":"success"}\n',
    ])) as unknown as typeof fetch;

  const seen: PullProgress[] = [];
  await pullOllamaModel('http://localhost:11434', 'qwen3:4b', (p) => seen.push(p));
  expect(seen).toEqual([
    { status: 'pulling manifest', completed: undefined, total: undefined },
    { status: 'downloading', completed: 50, total: 100 },
    { status: 'success', completed: undefined, total: undefined },
  ]);
});

function captureFetch(status: number, body: unknown): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'X',
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { urls };
}

test('probe resolves size from the manifest layers, defaulting the tag to latest', async () => {
  const { urls } = captureFetch(200, { layers: [{ size: 400 }, { size: 100 }, {}] });
  expect(await probeOllamaRegistry('qwen3')).toEqual({ exists: true, sizeBytes: 500 });
  expect(urls[0]).toBe('https://registry.ollama.ai/v2/library/qwen3/manifests/latest');
});

test('probe addresses tags and namespaced models correctly', async () => {
  const { urls } = captureFetch(200, { layers: [] });
  await probeOllamaRegistry('qwen3:4b');
  await probeOllamaRegistry('someuser/custom:v2');
  expect(urls).toEqual([
    'https://registry.ollama.ai/v2/library/qwen3/manifests/4b',
    'https://registry.ollama.ai/v2/someuser/custom/manifests/v2',
  ]);
});

test('probe reports a 404 as not existing, other failures as errors', async () => {
  captureFetch(404, {});
  expect(await probeOllamaRegistry('nope:1b')).toEqual({ exists: false });
  captureFetch(500, {});
  await expect(probeOllamaRegistry('qwen3')).rejects.toThrow('HTTP 500');
});

test('cached probe hits the registry once per model', async () => {
  const { urls } = captureFetch(200, { layers: [{ size: 7 }] });
  await probeOllamaRegistryCached('cache-test:1b');
  await probeOllamaRegistryCached('cache-test:1b');
  expect(urls.length).toBe(1);
});

test('pullOllamaModel rejects on an error line from the service', async () => {
  globalThis.fetch = (async () =>
    ndjsonResponse([
      '{"status":"pulling manifest"}\n',
      '{"error":"pull model manifest: file does not exist"}\n',
    ])) as unknown as typeof fetch;
  await expect(pullOllamaModel('http://localhost:11434', 'nope:1b', () => {})).rejects.toThrow(
    'file does not exist',
  );
});
