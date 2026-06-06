import { openAttachment } from '../../state/attachment-viewer-store';

type GeneratedImageProps = {
  url: string;
  mediaType: string;
  filename?: string;
};

/** An image the agent produced, shown inline. Click to open the full viewer
 *  (zoom + download), reusing the attachment viewer. */
export function GeneratedImage({
  url,
  mediaType,
  filename,
}: GeneratedImageProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => openAttachment({ filename: filename ?? '生成的图片', mediaType, url })}
      className="my-3 block overflow-hidden rounded-xl border border-border-default"
    >
      <img
        src={url}
        alt={filename ?? 'generated'}
        className="max-h-[200px] w-auto max-w-full object-contain"
      />
    </button>
  );
}
