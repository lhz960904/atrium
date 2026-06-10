import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Copy-to-clipboard button with a brief checkmark confirmation. `text` may be a
 * thunk for content that's only known at click time (e.g. read off the DOM).
 */
export function CopyButton({ text }: { text: string | (() => string) }): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard.writeText(typeof text === 'function' ? text() : text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded p-1 text-fg-tertiary transition-colors hover:bg-elevated hover:text-fg-secondary"
      title={t('common.copy')}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}
