import { expect, test } from 'bun:test';
import type { ExportServer } from './json-config';
import { parseMcpJson, planSync, serializeMcpServers } from './json-config';

test('parses the mcpServers dialect: stdio env becomes an encrypted secret', () => {
  const { servers, warnings } = parseMcpJson(
    JSON.stringify({
      mcpServers: {
        figma: {
          command: 'npx',
          args: ['-y', 'figma-developer-mcp', '--stdio'],
          env: { FIGMA_API_KEY: 'tok-123' },
        },
      },
    }),
  );
  expect(warnings).toEqual([]);
  expect(servers).toHaveLength(1);
  expect(servers[0]).toMatchObject({
    name: 'figma',
    enabled: true,
    transport: 'stdio',
    config: { command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'], env: {} },
    secrets: { env: { FIGMA_API_KEY: 'tok-123' } },
  });
});

test('infers transport from command/url when type is absent', () => {
  const { servers } = parseMcpJson(
    JSON.stringify({
      mcpServers: {
        local: { command: 'uvx', args: ['x'] },
        remote: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } },
      },
    }),
  );
  expect(servers.map((s) => [s.name, s.transport])).toEqual([
    ['local', 'stdio'],
    ['remote', 'http'],
  ]);
  expect(servers[1].secrets.headers).toEqual({ Authorization: 'Bearer x' });
});

test('accepts the VS Code "servers" dialect and streamable-http type', () => {
  const { servers } = parseMcpJson(
    JSON.stringify({
      servers: {
        slack: { type: 'streamable-http', url: 'https://mcp.slack.com/mcp' },
      },
    }),
  );
  expect(servers[0]).toMatchObject({ name: 'slack', transport: 'http' });
});

test('accepts a bare server map with no wrapper key', () => {
  const { servers } = parseMcpJson(
    JSON.stringify({ ctx7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } }),
  );
  expect(servers[0]).toMatchObject({ name: 'ctx7', transport: 'stdio' });
});

test('warns on dropped auth/envFile and on variable interpolation, and skips bad entries', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture exercises ${...} detection
  const interpValue = '${env:KEY}';
  const { servers, warnings } = parseMcpJson(
    JSON.stringify({
      mcpServers: {
        oauthy: { url: 'https://x.example.com/mcp', auth: { CLIENT_ID: 'a' } },
        interp: { command: 'run', env: { KEY: interpValue } },
        filey: { command: 'run', envFile: '.env' },
        broken: { note: 'no command or url' },
      },
    }),
  );
  expect(servers.map((s) => s.name).sort()).toEqual(['filey', 'interp', 'oauthy']);
  expect(warnings.some((w) => w.includes('oauthy') && w.includes('OAuth'))).toBe(true);
  expect(warnings.some((w) => w.includes('interp') && w.includes('expand'))).toBe(true);
  expect(warnings.some((w) => w.includes('filey') && w.includes('envFile'))).toBe(true);
  expect(warnings.some((w) => w.includes('broken'))).toBe(true);
});

test('honors enabled:false but defaults to enabled', () => {
  const { servers } = parseMcpJson(
    JSON.stringify({ mcpServers: { off: { command: 'x', enabled: false } } }),
  );
  expect(servers[0].enabled).toBe(false);
});

test('throws on unusable top-level input', () => {
  expect(() => parseMcpJson('not json')).toThrow(/valid JSON/);
  expect(() => parseMcpJson(JSON.stringify({ nope: 1 }))).toThrow(/mcpServers/);
});

const stdioServer = (): ExportServer => ({
  name: 'figma',
  enabled: true,
  transport: 'stdio',
  config: { command: 'npx', args: ['--stdio'], env: {}, envPassthrough: ['PATH'], cwd: '~/c' },
  secrets: { env: { FIGMA_API_KEY: 'tok-123' } },
});

test('serialize writes secret values in plaintext', () => {
  const out = JSON.parse(serializeMcpServers([stdioServer()]));
  expect(out.mcpServers.figma.env).toEqual({ FIGMA_API_KEY: 'tok-123' });
});

test('serialize marks disabled servers and omits empty fields', () => {
  const out = JSON.parse(
    serializeMcpServers([
      {
        name: 'bare',
        enabled: false,
        transport: 'stdio',
        config: { command: 'x', args: [], env: {}, envPassthrough: [], cwd: undefined },
        secrets: {},
      },
    ]),
  );
  expect(out.mcpServers.bare).toEqual({ type: 'stdio', command: 'x', enabled: false });
});

test('export round-trips back through parse', () => {
  const original = stdioServer();
  const json = serializeMcpServers([original]);
  const { servers, warnings } = parseMcpJson(json);
  expect(warnings).toEqual([]);
  expect(servers[0]).toEqual(original);
});

test('http config extensions round-trip', () => {
  const original: ExportServer = {
    name: 'gw',
    enabled: true,
    transport: 'http',
    config: {
      url: 'https://mcp.example.com/mcp',
      headers: {},
      headersFromEnv: { 'X-Tok': 'TOK_ENV' },
      bearerTokenEnvVar: 'BEARER',
    },
    secrets: { headers: { Authorization: 'Bearer live' } },
  };
  const { servers } = parseMcpJson(serializeMcpServers([original]));
  expect(servers[0]).toEqual(original);
});

test('planSync categorizes create/update/delete by name', () => {
  expect(planSync(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({
    create: ['a'],
    update: ['b', 'c'],
    delete: ['d'],
  });
});
