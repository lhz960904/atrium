import { expect, test } from 'bun:test';
import type { McpServerRow } from '../../db/schema';
import { httpConfigSchema, mcpSecretsSchema, resolveMcpServer, stdioConfigSchema } from './config';

const row = (over: Partial<McpServerRow>): McpServerRow =>
  ({
    id: '1',
    name: 'srv',
    enabled: true,
    transport: 'stdio',
    config: null,
    credentialsEncrypted: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as McpServerRow;

test('stdioConfigSchema applies defaults and requires a command', () => {
  expect(stdioConfigSchema.parse({ command: 'npx' })).toEqual({
    command: 'npx',
    args: [],
    env: {},
    envPassthrough: [],
    cwd: undefined,
  });
  expect(() => stdioConfigSchema.parse({})).toThrow();
});

test('stdioConfigSchema drops blank args from an untouched form row', () => {
  const c = stdioConfigSchema.parse({
    command: 'npx',
    args: ['@playwright/mcp@latest', '--extension', '', '   '],
  });
  expect(c.args).toEqual(['@playwright/mcp@latest', '--extension']);
});

test('stdioConfigSchema drops blank-key env/passthrough but keeps blank values', () => {
  const c = stdioConfigSchema.parse({
    command: 'srv',
    env: { '': 'orphan', '  ': 'orphan2', TOKEN: 'x', EMPTY: '' },
    envPassthrough: ['PATH', '', '  '],
  });
  expect(c.env).toEqual({ TOKEN: 'x', EMPTY: '' });
  expect(c.envPassthrough).toEqual(['PATH']);
});

test('stdioConfigSchema trims the command and rejects a blank one', () => {
  expect(stdioConfigSchema.parse({ command: '  npx  ' }).command).toBe('npx');
  expect(() => stdioConfigSchema.parse({ command: '   ' })).toThrow();
});

test('stdioConfigSchema treats a blank cwd as unset', () => {
  expect(stdioConfigSchema.parse({ command: 'srv', cwd: '   ' }).cwd).toBeUndefined();
  expect(stdioConfigSchema.parse({ command: 'srv', cwd: '~/code' }).cwd).toBe('~/code');
});

test('httpConfigSchema drops blank-key headers and a blank bearer var', () => {
  const c = httpConfigSchema.parse({
    url: 'https://mcp.example.com',
    headers: { '': 'orphan', 'X-App': 'atrium' },
    headersFromEnv: { '': 'ENV', 'X-Token': 'MY_TOKEN_ENV' },
    bearerTokenEnvVar: '  ',
  });
  expect(c.headers).toEqual({ 'X-App': 'atrium' });
  expect(c.headersFromEnv).toEqual({ 'X-Token': 'MY_TOKEN_ENV' });
  expect(c.bearerTokenEnvVar).toBeUndefined();
});

test('mcpSecretsSchema drops blank-key secret entries', () => {
  expect(mcpSecretsSchema.parse({ env: { '': 'x', TOKEN: 'secret' } }).env).toEqual({
    TOKEN: 'secret',
  });
});

test('resolveMcpServer repairs a config already stored with a blank arg', () => {
  const r = resolveMcpServer(
    row({
      transport: 'stdio',
      config: { command: 'npx', args: ['@playwright/mcp@latest', '--extension', ''] },
    }),
    {},
  );
  expect(r).toMatchObject({ command: 'npx', args: ['@playwright/mcp@latest', '--extension'] });
});

test('httpConfigSchema validates the url and defaults headers', () => {
  expect(httpConfigSchema.parse({ url: 'https://mcp.example.com' })).toEqual({
    url: 'https://mcp.example.com',
    headers: {},
    headersFromEnv: {},
    bearerTokenEnvVar: undefined,
  });
  expect(() => httpConfigSchema.parse({ url: 'not-a-url' })).toThrow();
});

test('resolveMcpServer layers secret env over non-secret for stdio', () => {
  const r = resolveMcpServer(
    row({
      transport: 'stdio',
      config: {
        command: 'gh-mcp',
        args: ['serve'],
        env: { LOG: 'info', TOKEN: 'placeholder' },
        envPassthrough: ['PATH'],
        cwd: '~/code',
      },
    }),
    { env: { TOKEN: 'secret' } },
  );
  expect(r).toMatchObject({
    transport: 'stdio',
    command: 'gh-mcp',
    args: ['serve'],
    env: { LOG: 'info', TOKEN: 'secret' }, // secret wins on conflict
    envPassthrough: ['PATH'],
    cwd: '~/code',
  });
});

test('resolveMcpServer layers secret headers for http', () => {
  const r = resolveMcpServer(
    row({
      transport: 'http',
      config: {
        url: 'https://mcp.example.com',
        headers: { 'X-App': 'atrium' },
        headersFromEnv: { 'X-Token': 'MY_TOKEN_ENV' },
        bearerTokenEnvVar: 'MCP_BEARER_TOKEN',
      },
    }),
    { headers: { Authorization: 'Bearer x' } },
  );
  expect(r).toMatchObject({
    transport: 'http',
    url: 'https://mcp.example.com',
    headers: { 'X-App': 'atrium', Authorization: 'Bearer x' },
    headersFromEnv: { 'X-Token': 'MY_TOKEN_ENV' },
    bearerTokenEnvVar: 'MCP_BEARER_TOKEN',
  });
});
