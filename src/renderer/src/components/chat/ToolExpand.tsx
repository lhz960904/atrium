import type { Tool, ToolStatus } from '@shared/chat-types';
import type { ParseKeys } from 'i18next';
import { Ban, CheckCircle2, Loader2, TriangleAlert, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openAttachment } from '../../state/attachment-viewer-store';

export function ToolExpand({ tool }: { tool: Tool }): React.JSX.Element {
  const { t } = useTranslation();
  const isShell = tool.command !== undefined;
  const hasOutput = tool.output !== undefined && tool.output !== '';

  return (
    <div className="mb-3 rounded-lg bg-toolcall-bg p-4 font-mono text-sm leading-normal">
      {tool.typeLabel && <div className="mb-3 text-fg-tertiary text-sm">{tool.typeLabel}</div>}

      {isShell && (
        <div className="mb-3 whitespace-pre-wrap break-all text-fg-primary">
          <span className="mr-2 select-none text-fg-tertiary">$</span>
          {tool.command}
        </div>
      )}

      {hasOutput ? (
        <div className="atrium-tool-output mb-3 max-h-[240px] overflow-y-auto whitespace-pre-wrap text-fg-secondary">
          {tool.output}
        </div>
      ) : isShell ? (
        <div className="mb-3 text-fg-disabled italic opacity-85">{t('tool.noOutput')}</div>
      ) : null}

      {tool.screenshot && (
        <button
          type="button"
          onClick={() =>
            openAttachment({
              filename: tool.screenshot?.filename ?? 'screenshot.png',
              mediaType: tool.screenshot?.mediaType ?? 'image/png',
              url: tool.screenshot?.dataUrl ?? '',
            })
          }
          className="mb-3 block overflow-hidden rounded-lg border border-border-default"
        >
          <img
            src={tool.screenshot.dataUrl}
            alt=""
            className="max-h-[220px] w-auto max-w-full object-contain"
          />
        </button>
      )}

      <ToolStatusRow status={tool.status} />
    </div>
  );
}

function ToolStatusRow({ status }: { status: ToolStatus }): React.JSX.Element {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div className={`flex items-center justify-end gap-1 text-sm ${meta.cls}`}>
      <Icon className={`size-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      <span>{t(meta.labelKey)}</span>
    </div>
  );
}

const STATUS_META: Record<
  ToolStatus,
  { labelKey: ParseKeys; cls: string; icon: typeof CheckCircle2 }
> = {
  success: { labelKey: 'status.success', cls: 'text-success', icon: CheckCircle2 },
  error: { labelKey: 'status.error', cls: 'text-danger', icon: XCircle },
  warning: { labelKey: 'status.warning', cls: 'text-warning', icon: TriangleAlert },
  running: { labelKey: 'status.running', cls: 'text-accent', icon: Loader2 },
  cancelled: { labelKey: 'status.cancelled', cls: 'text-fg-disabled', icon: Ban },
};
