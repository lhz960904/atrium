import { expect, test } from 'bun:test';
import { APICallError } from 'ai';
import { readableError } from './errors';

const apiError = (responseBody?: string): APICallError =>
  new APICallError({
    message: 'sdk fallback message',
    url: 'https://api.example.com/v1/chat',
    requestBodyValues: {},
    statusCode: 402,
    responseBody,
  });

test('digs the provider message out of the response body', () => {
  const out = readableError(
    apiError(JSON.stringify({ error: { message: 'Insufficient Balance' } })),
  );
  expect(out).toBe('Insufficient Balance');
});

test('falls back to the SDK message when the body has no error text', () => {
  expect(readableError(apiError('not json'))).toBe('sdk fallback message');
  expect(readableError(apiError(undefined))).toBe('sdk fallback message');
});

test('handles plain errors and non-errors', () => {
  expect(readableError(new Error('boom'))).toBe('boom');
  expect(readableError('weird')).toBe('weird');
});
