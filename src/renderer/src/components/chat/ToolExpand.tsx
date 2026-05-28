import type { Tool, ToolStatus } from '@shared/chat-types';
import { Ban, CheckCircle2, Loader2, TriangleAlert, XCircle } from 'lucide-react';

export function ToolExpand({ tool }: { tool: Tool }): React.JSX.Element {
  const isShell = tool.kind === 'shell' && tool.command !== undefined;
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
        <div className="mb-3 text-fg-disabled italic opacity-85">No output</div>
      ) : null}

      <ToolStatusRow status={tool.status} />
    </div>
  );
}

function ToolStatusRow({ status }: { status: ToolStatus }): React.JSX.Element {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div className={`flex items-center justify-end gap-1 text-sm ${meta.cls}`}>
      <Icon className={`size-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      <span>{meta.label}</span>
    </div>
  );
}

const STATUS_META: Record<ToolStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  success: { label: 'Success', cls: 'text-success', icon: CheckCircle2 },
  error: { label: 'Error', cls: 'text-danger', icon: XCircle },
  warning: { label: 'Warning', cls: 'text-warning', icon: TriangleAlert },
  running: { label: 'Running…', cls: 'text-accent', icon: Loader2 },
  cancelled: { label: 'Cancelled', cls: 'text-fg-disabled', icon: Ban },
};
