import { Handshake } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { useStartOnboarding } from '../../../lib/use-onboarding';

type Target = 'soul' | 'user';

function IdentityCard({
  target,
  file,
  title,
  hint,
}: {
  target: Target;
  file: string;
  title: string;
  hint: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const query = trpc.profile.get.useQuery({ target });
  const content = query.data ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const save = trpc.profile.set.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.profile.get.invalidate({ target }),
        utils.profile.displayName.invalidate(),
        utils.profile.needsOnboarding.invalidate(),
      ]);
      setEditing(false);
    },
  });

  const begin = (): void => {
    setDraft(content);
    setEditing(true);
  };
  const commit = (): void => {
    if (draft.trim()) save.mutate({ target, content: draft });
  };

  return (
    <div>
      <h2 className="mb-2 flex items-baseline gap-2">
        <span className="font-medium text-fg-primary text-sm">{title}</span>
        <span className="font-mono text-fg-tertiary text-xs">{file}</span>
      </h2>
      <div className="rounded-lg border border-border-default bg-surface">
        <div className="flex items-center justify-between border-border-default border-b px-4 py-2.5">
          <span className="text-fg-tertiary text-xs">{hint}</span>
          {!editing && (
            <button
              type="button"
              onClick={begin}
              className="rounded-md border border-border-strong px-2.5 py-1 text-fg-secondary text-xs hover:border-fg-disabled hover:text-fg-primary"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        {editing ? (
          <div className="p-4">
            <textarea
              // biome-ignore lint/a11y/noAutofocus: focus the editor the user just opened
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              className="w-full resize-y rounded-lg border border-border-strong bg-canvas px-3 py-2.5 font-mono text-fg-primary text-xs leading-relaxed outline-0 focus:border-accent"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={commit}
                disabled={!draft.trim() || save.isLoading}
                className="rounded-lg bg-accent px-3 py-1.5 font-medium text-fg-on-accent text-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1.5 text-fg-tertiary text-sm hover:bg-surface-strong hover:text-fg-primary"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap p-4 font-mono text-fg-secondary text-xs leading-relaxed">
            {content || <span className="text-fg-tertiary">{t('settings.identity.notSet')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function IdentitySection(): React.JSX.Element {
  const { t } = useTranslation();
  const needsOnboarding = trpc.profile.needsOnboarding.useQuery();
  const { start, isPending } = useStartOnboarding();

  // Hold the layout until we know which state to show, so a fresh profile
  // doesn't flash the two cards before resolving to the onboarding prompt.
  if (needsOnboarding.data === undefined) return <div className="min-h-[200px]" />;

  if (needsOnboarding.data) {
    return (
      <div className="rounded-lg border border-border-strong border-dashed px-6 py-10 text-center">
        <Handshake className="mx-auto mb-3 size-6 text-accent" />
        <p className="mb-1.5 font-medium text-fg-primary text-sm">
          {t('settings.identity.emptyTitle')}
        </p>
        <p className="mx-auto mb-5 max-w-sm text-fg-tertiary text-xs leading-relaxed">
          {t('settings.identity.emptyBody')}
        </p>
        <button
          type="button"
          onClick={start}
          disabled={isPending}
          className="rounded-lg bg-accent px-3.5 py-2 font-medium text-fg-on-accent text-sm hover:bg-accent-hover disabled:opacity-40"
        >
          {t('settings.identity.start')}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-8 pb-4">
      <IdentityCard
        target="user"
        file="USER.md"
        title={t('settings.identity.you')}
        hint={t('settings.identity.youHint')}
      />
      <IdentityCard
        target="soul"
        file="SOUL.md"
        title={t('settings.identity.assistant')}
        hint={t('settings.identity.assistantHint')}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={isPending}
          className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-fg-secondary text-sm hover:border-fg-disabled hover:text-fg-primary disabled:opacity-40"
        >
          {t('settings.identity.reacquaint')}
        </button>
        <span className="text-fg-tertiary text-xs">{t('settings.identity.reacquaintHint')}</span>
      </div>
    </section>
  );
}
