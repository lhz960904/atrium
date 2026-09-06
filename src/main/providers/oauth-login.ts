import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai';
import { createLogger } from '../log';
import { piModels } from './pi-model';

const log = createLogger('providers');

/**
 * A subscription login, driven from the settings panel.
 *
 * The provider's flow owns the OAuth mechanics — it opens its own loopback
 * listener and races it against a pasted code — so all this layer does is carry
 * its two interaction points across the process boundary: the URL to open, and
 * the answer to whatever it asks. The renderer polls `read` rather than holding
 * a stream: a login is a handful of state changes over a minute or two, and a
 * poll survives the settings page being closed and reopened mid-flow.
 */
export type LoginState = {
  providerId: string;
  status: 'starting' | 'awaiting-browser' | 'awaiting-input' | 'finishing' | 'done' | 'error';
  /** The authorization URL, once the flow has produced one. */
  url?: string;
  /** What the flow last said — shown verbatim under the button. */
  message?: string;
  /** Set while the flow is waiting on something the user must paste. */
  inputPrompt?: string;
  inputPlaceholder?: string;
  error?: string;
};

type Pending = {
  state: LoginState;
  abort: AbortController;
  /** Resolves the flow's open question; absent when it isn't asking. */
  answer?: (value: string) => void;
};

/** The provider-owned flow; injectable so the state machine is testable alone. */
export type LoginFn = (providerId: string, interaction: AuthInteraction) => Promise<unknown>;

const flows = new Map<string, Pending>();

export function readLogin(providerId: string): LoginState | null {
  return flows.get(providerId)?.state ?? null;
}

export function cancelLogin(providerId: string): void {
  const pending = flows.get(providerId);
  if (!pending) return;
  pending.abort.abort();
  flows.delete(providerId);
}

/** Answer the flow's open question (a pasted code or redirect URL). */
export function answerLogin(providerId: string, value: string): boolean {
  const pending = flows.get(providerId);
  if (!pending?.answer) return false;
  pending.answer(value);
  pending.answer = undefined;
  pending.state.status = 'finishing';
  pending.state.inputPrompt = undefined;
  return true;
}

/**
 * Start a subscription login. Resolves as soon as the flow is under way — the
 * caller polls `readLogin` for the rest — and the credential lands in the
 * store the engine already reads from, so the next turn just works.
 */
export function startLogin(
  providerId: string,
  openUrl: (url: string) => void,
  onSuccess: () => void = () => {},
  login: LoginFn = (id, interaction) => piModels.login(id, 'oauth', interaction),
): LoginState {
  cancelLogin(providerId);

  const abort = new AbortController();
  const pending: Pending = { state: { providerId, status: 'starting' }, abort };
  flows.set(providerId, pending);

  const notify = (event: AuthEvent): void => {
    if (event.type === 'auth_url') {
      pending.state.url = event.url;
      pending.state.status = 'awaiting-browser';
      pending.state.message = event.instructions;
      openUrl(event.url);
      return;
    }
    if (event.type === 'info' || event.type === 'progress') {
      pending.state.message = event.message;
      return;
    }
    if (event.type === 'device_code') {
      pending.state.status = 'awaiting-browser';
      pending.state.url = event.verificationUri;
      pending.state.message = `Enter code ${event.userCode}`;
      openUrl(event.verificationUri);
    }
  };

  const prompt = (input: AuthPrompt): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const fail = () => reject(new Error('login cancelled'));
      if (abort.signal.aborted) return fail();
      abort.signal.addEventListener('abort', fail, { once: true });
      input.signal?.addEventListener('abort', fail, { once: true });
      pending.state.status = 'awaiting-input';
      pending.state.inputPrompt = input.message;
      pending.state.inputPlaceholder = 'placeholder' in input ? input.placeholder : undefined;
      pending.answer = resolve;
    });

  void login(providerId, { signal: abort.signal, prompt, notify })
    .then(() => {
      pending.state.status = 'done';
      pending.state.message = undefined;
      pending.state.inputPrompt = undefined;
      onSuccess();
      log.info(`${providerId} subscription login complete`);
    })
    .catch((err: unknown) => {
      pending.state.status = 'error';
      pending.state.error = err instanceof Error ? err.message : String(err);
      log.warn(`${providerId} subscription login failed: ${pending.state.error}`);
    });

  return pending.state;
}

/** Forget the stored subscription credential. */
export async function logout(providerId: string): Promise<void> {
  cancelLogin(providerId);
  await piModels.logout(providerId);
}

/** Whether a provider is currently authenticated, and by what. */
export async function authStatus(
  providerId: string,
): Promise<{ type: 'api_key' | 'oauth'; source?: string } | null> {
  try {
    return (await piModels.checkAuth(providerId)) ?? null;
  } catch {
    return null;
  }
}
