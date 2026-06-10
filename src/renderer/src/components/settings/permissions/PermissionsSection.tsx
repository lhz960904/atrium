import type { TrustRule } from '@shared/permissions/rules';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PERMISSION_MODE_META } from '../../../lib/permission-modes';
import { trpc } from '../../../lib/trpc';
import { useChatPermission } from '../../../lib/use-chat-permission';

/** A typed entry is a path when it looks like one (slash or ~/. prefix),
 *  otherwise a shell command. The user never picks a tool — just types the
 *  concrete command or path they trust. */
function looksLikePath(s: string): boolean {
  return s.startsWith('/') || s.startsWith('~') || s.startsWith('.') || s.includes('/');
}

function inputToRule(raw: string): TrustRule | null {
  const value = raw.trim();
  if (!value) return null;
  return looksLikePath(value)
    ? { tool: 'write_file', matcher: value }
    : { tool: 'bash', matcher: value };
}

export function PermissionsSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { mode, setMode } = useChatPermission();

  /** Plain-language description of a rule — never mentions the internal tool. */
  const ruleLabel = (rule: TrustRule): string =>
    rule.tool === 'bash'
      ? t('settings.permissions.allowCommand', { cmd: rule.matcher })
      : t('settings.permissions.allowPath', { path: rule.matcher });

  const utils = trpc.useUtils();
  const rules = trpc.settings.trustRules.useQuery();
  const refresh = (): void => {
    utils.settings.trustRules.invalidate();
  };
  const addRule = trpc.settings.addTrustRule.useMutation({ onSuccess: refresh });
  const deleteRule = trpc.settings.deleteTrustRule.useMutation({ onSuccess: refresh });

  const [draft, setDraft] = useState('');
  const pending = inputToRule(draft);

  const submit = (): void => {
    if (!pending) return;
    addRule.mutate(pending);
    setDraft('');
  };

  return (
    <section className="flex flex-col gap-10">
      <div>
        <h2 className="mb-3 font-medium text-fg-primary text-sm">
          {t('settings.permissions.mode')}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {PERMISSION_MODE_META.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                type="button"
                key={m.id}
                disabled={m.disabled}
                onClick={() => setMode(m.id)}
                className={`relative flex flex-col gap-2 rounded-lg border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-accent bg-accent-soft'
                    : 'border-border-default bg-surface hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon className={`size-[18px] ${active ? 'text-accent' : 'text-fg-secondary'}`} />
                  {active && <Check className="size-[14px] text-accent" />}
                </div>
                <div>
                  <div className="font-medium text-fg-primary text-sm">{t(m.labelKey)}</div>
                  <div className="text-fg-tertiary text-xs leading-snug">{t(m.descKey)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-1 font-medium text-fg-primary text-sm">
          {t('settings.permissions.trustList')}
        </h2>
        <p className="mb-3 text-fg-tertiary text-xs">{t('settings.permissions.trustHint')}</p>

        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('settings.permissions.addPlaceholder')}
            className="flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 text-fg-primary text-sm outline-0 placeholder:text-fg-disabled focus:border-accent"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 font-medium text-fg-on-accent text-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-[14px]" />
            {t('settings.permissions.add')}
          </button>
        </div>
        {pending && (
          <p className="mt-2 text-fg-tertiary text-xs">
            {t('settings.permissions.willAllow')}
            {ruleLabel(pending)}
          </p>
        )}

        <ul className="mt-4 flex flex-col gap-2">
          {rules.data && rules.data.length > 0 ? (
            rules.data.map((r) => (
              <li
                key={`${r.tool}:${r.matcher}`}
                className="flex items-center gap-3 rounded-lg border border-border-default bg-surface px-3.5 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-fg-secondary text-sm">
                  {ruleLabel(r)}
                </span>
                <button
                  type="button"
                  title={t('common.delete')}
                  onClick={() => deleteRule.mutate(r)}
                  className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-danger"
                >
                  <Trash2 className="size-[14px]" />
                </button>
              </li>
            ))
          ) : (
            <li className="rounded-lg border border-border-default border-dashed bg-surface px-4 py-8 text-center text-fg-tertiary text-sm">
              {t('settings.permissions.empty')}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
