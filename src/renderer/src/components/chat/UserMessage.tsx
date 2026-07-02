import type { AtriumUIMessage } from '@shared/chat';
import { ChevronDown, FileText, Package, Pencil } from 'lucide-react';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openAttachment } from '../../state/attachment-viewer-store';
import { CopyButton } from './CopyButton';

// Long messages (pasted logs, files) collapse to this many lines behind a
// "Show more" toggle so one message can't dominate the scroll.
const COLLAPSED_LINES = 10;
const COLLAPSED_STYLE: React.CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: COLLAPSED_LINES,
  overflow: 'hidden',
};

/**
 * Mentions serialize into the message text as <skill-use>name</skill-use> tags —
 * the composer writes them (see composer/skill-mention), the model reads them,
 * and here we extract them back into chips. Keep this tag in sync with the
 * composer. New reference kinds (files, repos…) add a branch here.
 */
const SKILL_USE = /<skill-use>([^<]+)<\/skill-use>/g;
// The onboarding kickoff carries the UI language for the AI in a hidden tag —
// the model reads it, but it should never show in the user's bubble.
const REPLY_LANGUAGE = /\n?<reply-language>[^<]*<\/reply-language>/g;

function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

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

export const UserMessage = memo(function UserMessage({
  id,
  parts,
  canEdit = false,
  onEdit,
}: {
  id: string;
  parts: AtriumUIMessage['parts'];
  /** Whether editing is currently allowed (thread idle, nothing pending). */
  canEdit?: boolean;
  /** Rewrite this message and re-run from here; drops later messages. */
  onEdit?: (id: string, text: string) => void | Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const text = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .replace(REPLY_LANGUAGE, '');
  const files = parts.filter((p) => p.type === 'file');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const startEdit = (): void => {
    setDraft(text);
    setSubmitting(false);
    setEditing(true);
  };
  const submitEdit = (): void => {
    if (submitting) return;
    if (draft.trim().length === 0) return;
    setSubmitting(true);
    // On success this bubble is replaced by the re-run (it unmounts); only a
    // failed truncation lands here, and re-enables the editor for a retry.
    Promise.resolve(onEdit?.(id, draft)).catch(() => setSubmitting(false));
  };

  const bodyRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  // Measure only while clamped — the clamped box's scrollHeight exceeds its
  // clientHeight exactly when content is truncated. Re-run on width changes
  // (wrapping shifts line count), never while expanded (where the two heights
  // match and would falsely read "fits").
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !collapsed) return;
    const measure = (): void => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  // Grow the editor to fit the seeded text on open, and focus with the caret
  // at the end so the user continues where they left off.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    autosize(el);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  return (
    <div className="group mb-5 flex flex-col items-end gap-1.5">
      {files.length > 0 && (
        <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
          {files.map((f, i) => {
            const view = (): void =>
              openAttachment({
                filename: f.filename ?? t('common.attachment'),
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
                  alt={f.filename ?? t('common.attachment')}
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
                <span className="min-w-0 truncate">{f.filename ?? t('common.attachment')}</span>
              </button>
            );
          })}
        </div>
      )}
      {editing ? (
        <div className="w-full rounded-2xl bg-user-bubble-bg px-4 py-3">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autosize(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitEdit();
              }
            }}
            rows={1}
            className="max-h-[320px] w-full resize-none overflow-y-auto bg-transparent text-base text-user-bubble-fg leading-snug outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-border-default bg-surface px-3 py-1.5 text-fg-secondary text-sm transition-colors hover:bg-elevated"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={submitting || draft.trim().length === 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-fg-on-accent text-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('composer.send')}
            </button>
          </div>
        </div>
      ) : (
        text.length > 0 && (
          <>
            <div className="max-w-[75%] rounded-2xl bg-user-bubble-bg px-4 py-2.5 text-base text-user-bubble-fg leading-snug">
              <div
                ref={bodyRef}
                className="whitespace-pre-wrap"
                style={collapsed ? COLLAPSED_STYLE : undefined}
              >
                {renderWithMentions(text)}
              </div>
              {overflowing && (
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => !c)}
                  className="mt-1.5 flex items-center gap-0.5 text-fg-tertiary text-sm transition-colors hover:text-fg-secondary"
                >
                  {collapsed ? t('chat.showMore') : t('chat.showLess')}
                  <ChevronDown
                    className={`size-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
                  />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <CopyButton text={text} />
              {canEdit && onEdit && (
                <button
                  type="button"
                  onClick={startEdit}
                  title={t('common.edit')}
                  className="rounded p-1 text-fg-tertiary transition-colors hover:bg-elevated hover:text-fg-secondary"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
});
