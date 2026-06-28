import {
  type OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { CLIENT_INFO } from './client-info';
import { startCallbackServer } from './oauth-callback';

const AUTH_TIMEOUT_MS = 5 * 60_000;

/** Persisted OAuth state for one server: the DCR registration and current tokens. */
export type McpOAuthState = {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
};

/** Load/save the encrypted OAuth state for one server (DB-backed; see store.ts). */
export type McpOAuthStore = {
  load(): McpOAuthState;
  save(state: McpOAuthState): void;
};

/**
 * The SDK drives OAuth 2.1 (discovery, DCR, PKCE, token exchange/refresh); this
 * provider just supplies storage and the redirect. `openBrowser` distinguishes
 * the two modes: when set (interactive) it opens the system browser; when absent
 * (silent background connect) redirecting throws, so a server needing auth fails
 * as Unauthorized rather than popping a browser unprompted.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private oauthState: McpOAuthState;
  private verifier = '';

  constructor(
    private readonly store: McpOAuthStore,
    private readonly opts: { redirectUrl: string; openBrowser?: (url: string) => void },
  ) {
    this.oauthState = store.load();
  }

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Atrium',
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.oauthState.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.oauthState = { ...this.oauthState, clientInformation: info as OAuthClientInformationFull };
    this.store.save(this.oauthState);
  }

  tokens(): OAuthTokens | undefined {
    return this.oauthState.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.oauthState = { ...this.oauthState, tokens };
    this.store.save(this.oauthState);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('no PKCE code verifier in this session');
    return this.verifier;
  }

  redirectToAuthorization(url: URL): void {
    if (!this.opts.openBrowser) throw new UnauthorizedError('interactive authorization required');
    this.opts.openBrowser(url.toString());
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') this.oauthState = {};
    else if (scope === 'tokens') this.oauthState = { ...this.oauthState, tokens: undefined };
    else if (scope === 'client')
      this.oauthState = { ...this.oauthState, clientInformation: undefined };
    if (scope === 'verifier' || scope === 'all') this.verifier = '';
    this.store.save(this.oauthState);
  }
}

/**
 * Run the interactive OAuth flow for a server: open the browser, catch the
 * redirect on a loopback port, exchange the code, and persist the tokens via the
 * store. Returns once tokens are saved (or throws on failure/timeout). Callers
 * reconnect afterward — the saved tokens make the next connect succeed silently.
 */
export async function runInteractiveOAuth(
  serverUrl: string,
  requestInit: RequestInit,
  store: McpOAuthStore,
  openBrowser: (url: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const callback = await startCallbackServer();
  try {
    const provider = new McpOAuthProvider(store, {
      redirectUrl: callback.redirectUrl,
      openBrowser,
    });
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider: provider,
      requestInit,
    });
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    try {
      await client.connect(transport, { signal });
      await client.close();
      return; // already authorized (valid stored tokens)
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
    }
    // The browser is open; wait for the redirect (or an abort) and finish the exchange.
    const code = await callback.waitForCode(AUTH_TIMEOUT_MS, signal);
    await transport.finishAuth(code);
    await transport.close();
  } finally {
    callback.close();
  }
}
