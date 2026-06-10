import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

export function BaseUrlField({
  providerId,
  initialValue,
  defaultBaseUrl,
}: {
  providerId: string;
  initialValue: string;
  defaultBaseUrl: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  // Local buffer only — parent remounts via key when provider switches.
  const [value, setValue] = useState(initialValue);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const updateConfig = trpc.providers.updateConfig.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });

  const scheduleSave = (next: string): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateConfig.mutate({ id: providerId, partial: { baseUrl: next.trim() } });
    }, 600);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
    scheduleSave(e.target.value);
  };

  return (
    <div>
      <label
        className="mb-1.5 block font-medium text-fg-secondary text-xs"
        htmlFor={`baseurl-${providerId}`}
      >
        {t('settings.providers.baseUrl')}{' '}
        <span className="text-fg-tertiary">{t('settings.providers.optional')}</span>
      </label>
      <input
        id={`baseurl-${providerId}`}
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={defaultBaseUrl}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border-default bg-elevated px-3 py-2 font-mono text-fg-primary text-sm outline-none placeholder:text-fg-disabled focus:border-accent"
      />
      <p className="mt-1.5 text-fg-tertiary text-xs">{t('settings.providers.baseUrlHint')}</p>
    </div>
  );
}
