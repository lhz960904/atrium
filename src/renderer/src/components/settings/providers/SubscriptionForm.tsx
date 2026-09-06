import { ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { ModelsBlock } from './ModelsBlock';
import type { ProviderView } from './types';

type Provider = Extract<ProviderView, { kind: 'subscription' }>;

/** A login is a handful of state changes over a minute or two; poll for them. */
const POLL_MS = 700;

const isRunning = (status: string | undefined): boolean =>
  status === 'starting' ||
  status === 'awaiting-browser' ||
  status === 'awaiting-input' ||
  status === 'finishing';

/**
 * Signing into a vendor subscription instead of pasting a key.
 *
 * The whole OAuth flow lives in main; this carries its two interaction points.
 * A flow can ask for a choice (which way to sign in) or for something typed (a
 * code pasted back when the browser can't hand it over — a login finished on
 * another machine), so both shapes are rendered.
 */
export function SubscriptionLogin({
  providerId,
  hasCredentials,
}: {
  providerId: string;
  hasCredentials: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [pasted, setPasted] = useState('');
  const [polling, setPolling] = useState(false);

  const state = trpc.providers.loginState.useQuery(
    { id: providerId },
    { refetchInterval: polling ? POLL_MS : false },
  );
  const status = state.data?.status;
  const running = isRunning(status);
  if (running !== polling) setPolling(running);

  const refresh = (): void => {
    void state.refetch();
    void utils.providers.list.invalidate();
  };

  // The credential lands in main, not here: when the flow reports it is done,
  // the provider row is what changed, and nothing else would go re-read it.
  useEffect(() => {
    if (status === 'done') void utils.providers.list.invalidate();
  }, [status, utils]);
  const start = trpc.providers.startLogin.useMutation({ onSettled: refresh });
  const submit = trpc.providers.submitLogin.useMutation({ onSettled: refresh });
  const cancel = trpc.providers.cancelLogin.useMutation({ onSettled: refresh });
  const signOut = trpc.providers.signOut.useMutation({ onSettled: refresh });

  const options = state.data?.options;

  return (
    <div className="flex flex-col gap-2">
      {hasCredentials && !running ? (
        <div className="flex items-center gap-3">
          <span className="text-fg-tertiary text-sm">{t('settings.providers.signedIn')}</span>
          <button
            type="button"
            className="rounded-md border border-border-default px-3 py-1.5 text-sm hover:bg-surface-strong"
            onClick={() => signOut.mutate({ id: providerId })}
          >
            {t('settings.providers.signOut')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={running}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-60"
            onClick={() => start.mutate({ id: providerId })}
          >
            {running && <Loader2 className="size-3.5 animate-spin" />}
            {t('settings.providers.signIn')}
          </button>
          {running && (
            <button
              type="button"
              className="text-fg-tertiary text-sm hover:text-fg-secondary"
              onClick={() => cancel.mutate({ id: providerId })}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      )}

      {state.data?.message && (
        <p className="text-fg-tertiary text-xs leading-snug">{state.data.message}</p>
      )}
      {state.data?.error && <p className="text-danger text-xs">{state.data.error}</p>}

      {status === 'awaiting-input' && state.data?.inputPrompt && (
        <p className="text-fg-secondary text-xs">{state.data.inputPrompt}</p>
      )}

      {status === 'awaiting-input' && options && (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="rounded-md border border-border-default px-3 py-1.5 text-sm hover:bg-surface-strong"
              onClick={() => submit.mutate({ id: providerId, value: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {status === 'awaiting-input' && !options && (
        <div className="flex items-center gap-2">
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={state.data?.inputPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-border-default bg-surface-base px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={!pasted.trim()}
            className="rounded-md border border-border-default px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={() => {
              submit.mutate({ id: providerId, value: pasted.trim() });
              setPasted('');
            }}
          >
            {t('settings.providers.submitCode')}
          </button>
        </div>
      )}
    </div>
  );
}

/** The whole panel for a provider that is only ever signed into. */
export function SubscriptionForm({ provider }: { provider: Provider }): React.JSX.Element {
  const { t } = useTranslation();
  const config = (provider.config ?? {}) as { enabledModels?: string[] };
  const models = (provider.models ?? []).map((m) => m.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg-secondary text-sm">
            {t('settings.providers.subscription')}
          </span>
          <a
            href={provider.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-accent text-xs hover:underline"
          >
            {t('settings.providers.manage')}
            <ExternalLink className="size-3" />
          </a>
        </div>
        <SubscriptionLogin providerId={provider.id} hasCredentials={provider.hasCredentials} />
      </div>

      <ModelsBlock
        providerId={provider.id}
        canFetch={false}
        emptyHint={t('settings.providers.fetchHintNoKey')}
        models={models}
        enabledModels={config.enabledModels ?? []}
      />
    </div>
  );
}
