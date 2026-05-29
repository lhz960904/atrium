import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../../lib/trpc';

/**
 * Password-style input that reads the encrypted credential on mount,
 * shows it as masked dots, and writes back on a 600ms debounce so the
 * user gets autosave without thrashing the safeStorage roundtrip.
 *
 * The eye toggle flips the input between `password` and `text` types —
 * the underlying value is already in memory once mounted, so revealing
 * doesn't trigger another decrypt call.
 */
export function ApiKeyField({
  providerId,
  hasCredentials,
  consoleUrl,
}: {
  providerId: string;
  hasCredentials: boolean;
  consoleUrl?: string;
}): React.JSX.Element {
  const utils = trpc.useUtils();
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mount; parent remounts on provider switch via key
  useEffect(() => {
    let cancelled = false;
    if (!hasCredentials) {
      setLoaded(true);
      return;
    }
    utils.providers.getCredentials.fetch({ id: providerId }).then((plaintext) => {
      if (cancelled) return;
      setValue(plaintext ?? '');
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCredentials = trpc.providers.setCredentials.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });
  const clearCredentials = trpc.providers.clearCredentials.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });

  const scheduleSave = (next: string): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        if (hasCredentials) clearCredentials.mutate({ id: providerId });
      } else {
        setCredentials.mutate({ id: providerId, plaintext: trimmed });
      }
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
        htmlFor={`apikey-${providerId}`}
      >
        API Key
      </label>
      <div className="relative">
        <input
          id={`apikey-${providerId}`}
          type={reveal ? 'text' : 'password'}
          value={loaded ? value : ''}
          onChange={handleChange}
          placeholder={loaded ? 'sk-...' : 'Loading…'}
          autoComplete="off"
          spellCheck={false}
          disabled={!loaded}
          className="w-full rounded-md border border-border-default bg-elevated px-3 py-2 pr-9 font-mono text-fg-primary text-sm outline-none placeholder:text-fg-disabled focus:border-accent disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          title={reveal ? '隐藏' : '显示'}
          className="-translate-y-1/2 absolute top-1/2 right-2 rounded p-1 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
        >
          {reveal ? <EyeOff className="size-[14px]" /> : <Eye className="size-[14px]" />}
        </button>
      </div>
      <p className="mt-1.5 text-fg-tertiary text-xs">
        {consoleUrl && (
          <>
            {' '}
            Get your API key from{' '}
            <a
              href={consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {hostnameOf(consoleUrl)} ↗
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
