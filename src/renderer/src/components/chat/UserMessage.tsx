import type { AtriumUIMessage } from '@shared/chat';
import { FileText, Package } from 'lucide-react';
import { openAttachment } from '../../state/attachment-viewer-store';
import { CopyButton } from './CopyButton';

/**
 * Mentions serialize into the message text as <skill-use>name</skill-use> tags —
 * the composer writes them (see composer/skill-mention), the model reads them,
 * and here we extract them back into chips. Keep this tag in sync with the
 * composer. New reference kinds (files, repos…) add a branch here.
 */
const SKILL_USE = /<skill-use>([^<]+)<\/skill-use>/g;

function renderWithMentions(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  SKILL_USE.lastIndex = 0;
  for (let m = SKILL_USE.exec(text); m !== null; m = SKILL_USE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span key={key++} className="font-medium text-accent">
        <Package className="mr-1 inline size-3.5 align-middle" />
        {m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length > 0 ? nodes : text;
}

export function UserMessage({ parts }: { parts: AtriumUIMessage['parts'] }): React.JSX.Element {
  const text = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const files = parts.filter((p) => p.type === 'file');
  return (
    <div className="group mb-5 flex flex-col items-end gap-1.5">
      {files.length > 0 && (
        <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
          {files.map((f, i) => {
            const view = (): void =>
              openAttachment({
                filename: f.filename ?? '附件',
                mediaType: f.mediaType,
                url: f.url,
              });
            // Uniform height so a tall image can't stretch a file chip next to
            // it — images shrink to a thumbnail (detail is a click away in the
            // viewer) and everything lines up.
            return f.mediaType?.startsWith('image/') ? (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: file parts are static, never reordered
                key={i}
                type="button"
                onClick={view}
                className="h-12 overflow-hidden rounded-lg border border-border-default transition-opacity hover:opacity-90"
              >
                <img
                  src={f.url}
                  alt={f.filename ?? 'image'}
                  className="h-full w-auto max-w-[240px] object-cover"
                />
              </button>
            ) : (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: file parts are static, never reordered
                key={i}
                type="button"
                onClick={view}
                className="flex h-12 max-w-[220px] items-center gap-2 rounded-lg border border-border-default bg-surface px-3 text-fg-secondary text-xs hover:border-border-strong hover:bg-elevated"
              >
                <FileText className="size-4 shrink-0 text-fg-tertiary" />
                <span className="min-w-0 truncate">{f.filename ?? '附件'}</span>
              </button>
            );
          })}
        </div>
      )}
      {text.length > 0 && (
        <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-user-bubble-bg px-4 py-2.5 text-base text-user-bubble-fg leading-snug">
          {renderWithMentions(text)}
        </div>
      )}
      {text.length > 0 && (
        <div className="opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={text} />
        </div>
      )}
    </div>
  );
}
