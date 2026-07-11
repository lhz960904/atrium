import { expect, test } from 'bun:test';
import { APICallError, RetryError } from 'ai';
import { readableError } from './errors';

const apiError = (responseBody?: string): APICallError =>
  new APICallError({
    message: 'sdk fallback message',
    url: 'https://api.example.com/v1/chat',
    requestBodyValues: {},
    statusCode: 402,
    responseBody,
  });

const retryError = (...errors: unknown[]): RetryError =>
  new RetryError({
    message: `Failed after ${errors.length} attempts. Last error: Too Many Requests`,
    reason: 'maxRetriesExceeded',
    errors,
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

test('unwraps a retry failure down to the provider message', () => {
  const last = apiError(JSON.stringify({ error: { message: 'TPM limit exceeded, retry in 60s' } }));
  const out = readableError(retryError(apiError('Too Many Requests'), last));
  expect(out).toBe('Failed after 2 attempts. Last error: TPM limit exceeded, retry in 60s');
});

test('retry failure keeps the SDK message when the last error has no body text', () => {
  expect(readableError(retryError(apiError(undefined)))).toBe(
    'Failed after 1 attempts. Last error: sdk fallback message',
  );
});
