import { expect, test } from 'bun:test';
import { anthropicApiBase } from './manifest';

test('appends /v1 to vendor-documented bases', () => {
  expect(anthropicApiBase('https://ark.cn-beijing.volces.com/api/plan')).toBe(
    'https://ark.cn-beijing.volces.com/api/plan/v1',
  );
  expect(anthropicApiBase('https://api.moonshot.cn/anthropic')).toBe(
    'https://api.moonshot.cn/anthropic/v1',
  );
  expect(anthropicApiBase('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1');
});

test('keeps bases that already end in /v1', () => {
  expect(anthropicApiBase('https://aihubmix.com/v1')).toBe('https://aihubmix.com/v1');
});

test('strips trailing slashes before deciding', () => {
  expect(anthropicApiBase('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1');
  expect(anthropicApiBase('https://api.moonshot.cn/anthropic/')).toBe(
    'https://api.moonshot.cn/anthropic/v1',
  );
});
