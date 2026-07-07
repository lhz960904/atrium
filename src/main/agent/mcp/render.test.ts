import { expect, test } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { imageOutputToModelOutput } from '../tools/output';
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

test('model output: plain string passes through as text', () => {
  expect(imageOutputToModelOutput('hello', true)).toEqual({ type: 'text', value: 'hello' });
});

test('model output: images become image-data parts when supported', () => {
  expect(
    imageOutputToModelOutput(
      { text: 'shot', images: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,aGk=' }] },
      true,
    ),
  ).toEqual({
    type: 'content',
    value: [
      { type: 'text', text: 'shot' },
      { type: 'image-data', data: 'aGk=', mediaType: 'image/png' },
    ],
  });
});

test('model output: images degrade to a note when unsupported', () => {
  expect(
    imageOutputToModelOutput(
      { text: 'shot', images: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,aGk=' }] },
      false,
    ),
  ).toEqual({
    type: 'text',
    value: 'shot\n[1 image(s) omitted: the current model cannot view images]',
  });
});

test('model output: image-only result omits the empty text part', () => {
  expect(
    imageOutputToModelOutput(
      { text: '', images: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,aGk=' }] },
      true,
    ),
  ).toEqual({
    type: 'content',
    value: [{ type: 'image-data', data: 'aGk=', mediaType: 'image/png' }],
  });
});
