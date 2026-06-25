import * as Collapsible from '@radix-ui/react-collapsible';
import type { ClarifyResult } from '@shared/chat-types';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewSegment } from '../../lib/assistant-view';
import { formatTokens } from '../../lib/format';
import { LiveLabel } from './LiveLabel';
import { SegmentList } from './SegmentList';

type TraceBlockProps = {
  kind: 'thought' | 'work';
  segments: ViewSegment[];
  toolCount?: number;
  streaming: boolean;
  /** Whether content follows this block (answer / a later block) — if not, it
   *  stays expanded so the message is never a bare header. */
  hasFinal: boolean;
  createdAt?: number;
  durationMs?: number;
  /** Turn-total tokens, shown next to the duration once the turn ends. */
  totalTokens?: number;
  onAnswer: (toolCallId: string, result: ClarifyResult) => void;
};

/**
 * The collapsible header over part of an assistant turn — either the reasoning
 * ("Thought …") or the work, i.e. tool calls + narrative ("Worked …"). Open
 * with a live ticker + pulsing dot while that part streams, then collapses to
 * a static summary.
 */
export function TraceBlock({
  kind,
  segments,
  toolCount = 0,
  streaming,
  hasFinal,
  createdAt,
  durationMs,
  totalTokens,
  onAnswer,
}: TraceBlockProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(streaming);
  // Follow the stream: open while this part streams; once done, collapse only
  // if something follows it — otherwise the message would be a bare header.
  useEffect(() => setOpen(streaming || !hasFinal), [streaming, hasFinal]);

  const rest = kind === 'thought' ? t('trace.thought') : t('trace.worked');
  const live = kind === 'thought' ? t('trace.thinking') : t('trace.working');

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={`group inline-flex items-center gap-2 py-1 text-md ${
            streaming ? 'text-fg-secondary' : 'text-fg-tertiary hover:text-fg-secondary'
          }`}
        >
          {streaming && <span className="size-2 animate-pulse rounded-full bg-accent" />}
          {streaming ? (
            <LiveLabel verb={live} createdAt={createdAt} />
          ) : (
            <span>
              {durationMs != null
                ? t('trace.duration', { verb: rest, duration: formatRest(durationMs) })
                : rest}
              {kind === 'work' && toolCount > 0 && (
                <span className="text-fg-disabled">
                  {' '}
                  · {t('trace.steps', { count: toolCount })}
                </span>
              )}
              {totalTokens != null && (
                <span className="text-fg-disabled">
                  {' '}
                  · {t('trace.tokens', { tokens: formatTokens(totalTokens) })}
                </span>
              )}
            </span>
          )}
          <ChevronRight
            className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="atrium-collapsible">
        <div className="pt-1 pb-2">
          <SegmentList segments={segments} onAnswer={onAnswer} streaming={streaming} />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function formatRest(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
