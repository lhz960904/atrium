import { Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** A pending composer attachment. The content is read into `url` (a data URL)
 *  at pick time, so it's a self-contained copy — moving/deleting the original
 *  file doesn't affect us. Maps directly to an AI SDK file part on send. */
export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  /** data URL with the file bytes embedded. */
  url: string;
  /** Size in bytes for display. Optional. */
  size?: number;
};

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const isImage = attachment.mediaType.startsWith('image/');
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border-default bg-surface py-1 pr-1 pl-2 text-fg-secondary text-xs">
      {isImage ? (
        <img
          src={attachment.url}
          alt={attachment.name}
          className="size-5 shrink-0 rounded object-cover"
        />
      ) : (
        <Paperclip className="size-3 shrink-0 text-fg-tertiary" />
      )}
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
      <button
        type="button"
        title={t('common.remove')}
        onClick={() => onRemove(attachment.id)}
        className="rounded p-0.5 text-fg-tertiary hover:bg-elevated hover:text-fg-primary"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
