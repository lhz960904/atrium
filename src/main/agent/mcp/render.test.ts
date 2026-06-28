import { expect, test } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { renderToolResult } from './render';

const result = (over: Partial<CallToolResult>): CallToolResult =>
  ({ content: [], ...over }) as CallToolResult;

test('joins text blocks with newlines', () => {
  expect(
    renderToolResult(
      result({
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      }),
    ),
  ).toBe('first\nsecond');
});

test('summarizes non-text blocks', () => {
  expect(
    renderToolResult(result({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] })),
  ).toBe('[image content: image/png]');
  expect(
    renderToolResult(result({ content: [{ type: 'resource_link', uri: 'file:///a', name: 'a' }] })),
  ).toBe('[resource: file:///a]');
});

test('inlines an embedded text resource', () => {
  expect(
    renderToolResult(
      result({ content: [{ type: 'resource', resource: { uri: 'file:///a', text: 'hi' } }] }),
    ),
  ).toBe('hi');
});

test('prefixes a tool error', () => {
  expect(
    renderToolResult(result({ content: [{ type: 'text', text: 'boom' }], isError: true })),
  ).toBe('The tool reported an error:\nboom');
});
