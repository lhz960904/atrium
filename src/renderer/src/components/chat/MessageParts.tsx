import type { AtriumUIMessage } from '@shared/chat';
import { getToolName, isToolUIPart } from 'ai';
import { AlertCircle, Check, ChevronRight, Loader2, Terminal } from 'lucide-react';
import { useState } from 'react';

// The exact part shape isToolUIPart narrows to (static + dynamic tool parts).
type AnyToolPart = Parameters<typeof getToolName>[0];

/**
 * Renders an assistant message's parts: prose text and tool calls. File
 * parts slot in here as another branch later.
 */
export function MessageParts({ parts }: { parts: AtriumUIMessage['parts'] }): React.JSX.Element {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are an append-only stream with no stable id
          return <TextPart key={i} text={part.text} />;
        }
        if (isToolUIPart(part)) {
          return <ToolPart key={part.toolCallId} part={part} />;
        }
        return null;
      })}
    </>
  );
}

function TextPart({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="my-3 whitespace-pre-wrap text-base text-fg-primary leading-relaxed">{text}</div>
  );
}

function ToolPart({ part }: { part: AnyToolPart }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const name = getToolName(part);
  const input = part.input as { description?: string; path?: string; command?: string } | undefined;
  const subject = input?.command ?? input?.path;
  const done = part.state === 'output-available';
  const error = part.state === 'output-error';

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border-default bg-surface text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Terminal className="size-[14px] shrink-0 text-fg-tertiary" />
        <span className="shrink-0 font-mono text-fg-primary text-xs">{name}</span>
        {subject && (
          <span className="min-w-0 flex-1 truncate font-mono text-fg-tertiary text-xs">
            {subject}
          </span>
        )}
        <span className="ml-auto shrink-0">
          {error ? (
            <AlertCircle className="size-[14px] text-danger" />
          ) : done ? (
            <Check className="size-[14px] text-success" />
          ) : (
            <Loader2 className="size-[14px] animate-spin text-fg-tertiary" />
          )}
        </span>
        <ChevronRight
          className={`size-[13px] shrink-0 text-fg-tertiary transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="border-border-default border-t px-3 py-2">
          {input?.description && (
            <p className="mb-2 text-fg-tertiary text-xs">{input.description}</p>
          )}
          {error ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-danger text-xs">
              {part.errorText}
            </pre>
          ) : done ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-fg-secondary text-xs">
              {String(part.output)}
            </pre>
          ) : (
            <p className="text-fg-tertiary text-xs">运行中…</p>
          )}
        </div>
      )}
    </div>
  );
}
