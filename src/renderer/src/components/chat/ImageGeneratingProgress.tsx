import { ImageIcon } from 'lucide-react';

/** Placeholder shown while a direct image-model turn generates — the turn
 *  streams only the image at the end, so the message is empty until then. */
export function ImageGeneratingProgress(): React.JSX.Element {
  return (
    <div className="mb-7">
      <div className="flex h-48 w-64 animate-pulse flex-col items-center justify-center gap-2 rounded-xl border border-border-default bg-elevated text-fg-tertiary">
        <ImageIcon className="size-6" />
        <span className="text-sm">正在生成图片…</span>
      </div>
    </div>
  );
}
