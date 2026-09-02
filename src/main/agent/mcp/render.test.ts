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

test('summarizes non-image non-text blocks', () => {
  expect(
    renderToolResult(result({ content: [{ type: 'audio', data: 'x', mimeType: 'audio/wav' }] })),
  ).toBe('[audio content: audio/wav]');
  expect(
    renderToolResult(result({ content: [{ type: 'resource_link', uri: 'file:///a', name: 'a' }] })),
  ).toBe('[resource: file:///a]');
});

test('lifts image blocks into structured output', () => {
  expect(
    renderToolResult(
      result({
        content: [
          { type: 'text', text: 'took a screenshot' },
          { type: 'image', data: 'aGk=', mimeType: 'image/png' },
        ],
      }),
    ),
  ).toEqual({
    text: 'took a screenshot',
    images: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,aGk=' }],
  });
});

test('inlines an embedded text resource', () => {
  expect(
    renderToolResult(
      result({ content: [{ type: 'resource', resource: { uri: 'file:///a', text: 'hi' } }] }),
    ),
  ).toBe('hi');
});

test('prefixes a tool error and keeps error results text-only', () => {
  expect(
    renderToolResult(
      result({
        content: [
          { type: 'text', text: 'boom' },
          { type: 'image', data: 'aGk=', mimeType: 'image/png' },
        ],
        isError: true,
      }),
    ),
  ).toBe('The tool reported an error:\nboom\n[image content: image/png]');
});
