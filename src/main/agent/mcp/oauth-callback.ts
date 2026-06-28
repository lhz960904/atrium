import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CallbackServer = {
  /** The loopback redirect URI to register and hand to the authorization server. */
  redirectUrl: string;
  /** Resolves with the `code` once the browser is redirected back; rejects on error/timeout/abort. */
  waitForCode(timeoutMs: number, signal?: AbortSignal): Promise<string>;
  close(): void;
};

const PAGE =
  '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem;text-align:center">' +
  '<h2>Authorized</h2><p>You can close this window and return to Atrium.</p></body>';

/**
 * A one-shot loopback HTTP server that catches the OAuth redirect. Binds an
 * OS-assigned port on 127.0.0.1 (RFC 8252 allows any loopback port), so each
 * auth attempt gets a fresh port — no fixed-port collisions.
 */
export async function startCallbackServer(): Promise<CallbackServer> {
  let resolveCode: (code: string) => void = () => {};
  let rejectCode: (err: Error) => void = () => {};
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
    if (code) resolveCode(code);
    else if (error) rejectCode(new Error(`authorization failed: ${error}`));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    redirectUrl: `http://127.0.0.1:${port}/callback`,
    waitForCode: (timeoutMs, signal) => {
      if (signal?.aborted) return Promise.reject(new Error('authorization cancelled'));
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('authorization timed out')), timeoutMs);
        const onAbort = (): void => reject(new Error('authorization cancelled'));
        signal?.addEventListener('abort', onAbort, { once: true });
        codePromise.then(resolve, reject).finally(() => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        });
      });
    },
    close: () => server.close(),
  };
}
