import { expect, test } from 'bun:test';
import { Refusal } from '@main/utils/refusal';
import {
  claudeCodeToMcpServers,
  codexTomlToMcpServers,
  normalizeConfigText,
  readImportFile,
  readImportSource,
} from './client-imports';
import { parseMcpJson } from './json-config';

const CODEX = `
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]

[mcp_servers.context7.env]
MY_ENV_VAR = "MY_ENV_VALUE"

[mcp_servers.inline]
command = "uvx"
args = ["tooluniverse"]
env = { PYTHONIOENCODING = "utf-8" }

[mcp_servers.remote]
url = "https://developers.openai.com/mcp"
bearer_token_env_var = "OAI_TOKEN"
`;

test('codex TOML maps to the mcpServers shape (env_vars, inline env, remote bearer)', () => {
  const servers = codexTomlToMcpServers(CODEX);
  expect(servers.context7).toEqual({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: { MY_ENV_VAR: 'MY_ENV_VALUE' },
    envPassthrough: ['LOCAL_TOKEN'],
  });
  expect(servers.inline).toEqual({
    type: 'stdio',
    command: 'uvx',
    args: ['tooluniverse'],
    env: { PYTHONIOENCODING: 'utf-8' },
  });
  expect(servers.remote).toEqual({
    type: 'http',
    url: 'https://developers.openai.com/mcp',
    bearerTokenEnvVar: 'OAI_TOKEN',
  });
});

test('codex output parses cleanly into Atrium servers', () => {
  const { servers, warnings } = parseMcpJson(
    JSON.stringify({ mcpServers: codexTomlToMcpServers(CODEX) }),
  );
  expect(warnings).toEqual([]);
  const ctx7 = servers.find((s) => s.name === 'context7');
  expect(ctx7).toMatchObject({
    transport: 'stdio',
    config: { command: 'npx', envPassthrough: ['LOCAL_TOKEN'] },
    secrets: { env: { MY_ENV_VAR: 'MY_ENV_VALUE' } },
  });
  const remote = servers.find((s) => s.name === 'remote');
  expect(remote).toMatchObject({ transport: 'http', config: { bearerTokenEnvVar: 'OAI_TOKEN' } });
});

test('claude code merges user-scope and every project scope, later name wins', () => {
  const merged = claudeCodeToMcpServers(
    JSON.stringify({
      mcpServers: { userA: { command: 'a' } },
      projects: {
        '/p1': { mcpServers: { shared: { command: 'from-p1' } } },
        '/p2': { mcpServers: { shared: { command: 'from-p2' }, projB: { command: 'b' } } },
      },
    }),
  );
  expect(merged).toEqual({
    userA: { command: 'a' },
    shared: { command: 'from-p2' },
    projB: { command: 'b' },
  });
});

test('claude code with empty top-level still surfaces project servers', () => {
  const { servers } = parseMcpJson(
    JSON.stringify({
      mcpServers: claudeCodeToMcpServers(
        JSON.stringify({ projects: { '/p': { mcpServers: { only: { command: 'x' } } } } }),
      ),
    }),
  );
  expect(servers.map((s) => s.name)).toEqual(['only']);
});

test('normalizeConfigText routes a picked file by extension and content', () => {
  const fromToml = parseMcpJson(
    normalizeConfigText('[mcp_servers.a]\ncommand = "x"\n', 'config.toml'),
  );
  expect(fromToml.servers.map((s) => s.name)).toEqual(['a']);

  const claudeJson = JSON.stringify({
    projects: { '/p': { mcpServers: { pj: { command: 'y' } } } },
  });
  const fromClaude = parseMcpJson(normalizeConfigText(claudeJson, 'anything.json'));
  expect(fromClaude.servers.map((s) => s.name)).toEqual(['pj']);

  const plain = JSON.stringify({ mcpServers: { z: { url: 'https://m.example.com/mcp' } } });
  const fromPlain = parseMcpJson(normalizeConfigText(plain, 'mcp.json'));
  expect(fromPlain.servers.map((s) => s.name)).toEqual(['z']);
});

test('normalizeConfigText falls back to TOML when content is not JSON', () => {
  const { servers } = parseMcpJson(normalizeConfigText('[mcp_servers.b]\ncommand = "z"\n', ''));
  expect(servers.map((s) => s.name)).toEqual(['b']);
});

test('a file the user picked that cannot be read is refused, naming the file', () => {
  // The picker closed a moment ago, so whatever went wrong the user can pick
  // again — which makes this their answer, not a fault to be logged.
  expect(() => readImportFile('/nowhere/atrium-does-not-exist.json')).toThrow(Refusal);
  expect(() => readImportFile('/nowhere/atrium-does-not-exist.json')).toThrow(
    /atrium-does-not-exist\.json/,
  );
});

test('a client with no config on this machine is refused by name', () => {
  // `cursor` is a real source; its config is what is missing.
  const read = () => readImportSource('cursor');
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(Refusal);
    expect((error as Error).message).toMatch(/Cursor/);
    return;
  }
  // A machine that really does have Cursor configured reads it instead, which is
  // the other correct outcome; the point is that it never throws a bare Error.
  expect(typeof read()).toBe('string');
});

test('an import source that does not exist is refused', () => {
  expect(() => readImportSource('nope' as never)).toThrow(Refusal);
});
