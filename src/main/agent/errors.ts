import { APICallError, RetryError } from 'ai';

/**
 * Retries for agent-loop model calls. The SDK default (2, exponential backoff
 * from 2s) gives up within ~6 seconds — too brief to outlive the per-minute
 * TPM throttles subscription providers enforce, where a 429 clears only once
 * the minute window slides. Six attempts back off through ~2 minutes
 * (2s→64s, or the server's Retry-After when present), long enough to ride out
 * a throttle window unattended. Genuinely non-retryable errors (auth,
 * validation) still surface immediately — the SDK only retries errors it
 * marks retryable.
 */
export const MODEL_CALL_MAX_RETRIES = 6;

/**
 * A human-readable message for the client. createUIMessageStream masks errors
 * as a generic string by default (don't leak internals); we override that to
 * surface the real reason. Provider errors bury the useful text in the response
 * body (e.g. "Insufficient Balance"), so dig that out before falling back to the
 * SDK's own message. We pass the provider's wording through as-is rather than
 * mapping status codes ourselves — codes diverge across providers (a 429 can mean
 * rate-limit or exhausted quota), so the original message is the honest signal.
 */
export function readableError(error: unknown): string {
  // A retry-exhausted failure only carries the HTTP status text ("Too Many
  // Requests"); the provider's actual explanation sits in the last underlying
  // error's response body, so unwrap and dig there.
  if (RetryError.isInstance(error) && error.lastError !== undefined) {
    return `Failed after ${error.errors.length} attempts. Last error: ${readableError(error.lastError)}`;
  }
  if (APICallError.isInstance(error)) {
    if (error.responseBody) {
      try {
        const parsed = JSON.parse(error.responseBody) as { error?: { message?: string } };
        if (parsed.error?.message) return parsed.error.message;
      } catch {
        // fall through to the SDK message
      }
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
