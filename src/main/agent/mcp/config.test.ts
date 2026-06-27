import { expect, test } from 'bun:test';
import type { McpServerRow } from '../../db/schema';
import { httpConfigSchema, resolveMcpServer, stdioConfigSchema } from './config';

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
