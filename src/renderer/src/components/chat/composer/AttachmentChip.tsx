import { Paperclip, X } from 'lucide-react';

export type Attachment = {
  id: string;
  name: string;
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
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border-default bg-surface px-2 py-1 text-fg-secondary text-xs">
      <Paperclip className="size-3 shrink-0 text-fg-tertiary" />
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
      <button
        type="button"
        title="Remove"
        onClick={() => onRemove(attachment.id)}
        className="rounded p-0.5 text-fg-tertiary hover:bg-elevated hover:text-fg-primary"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
