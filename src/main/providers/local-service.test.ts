import { afterEach, expect, test } from 'bun:test';
import { fetchOllamaModels, pingOllama } from './local-service';

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
