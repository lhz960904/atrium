import { useRef, useState } from 'react';
import { trpc } from '../../../lib/trpc';
import type { ProviderView } from './types';

type LocalCli = Extract<ProviderView, { kind: 'local-cli' }>;

export function LocalCliForm({ provider }: { provider: LocalCli }): React.JSX.Element {
  // The manifest launch defaults — shown as placeholders so the user sees what
  // runs when a field is left blank.
  const defaultCommand = provider.acp.via === 'binary' ? provider.acp.command : provider.acp.bin;
  const defaultArgs = provider.acp.via === 'binary' ? provider.acp.args.join(' ') : '';
  const config = (provider.config ?? {}) as { command?: string; args?: string };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <div className="rounded-lg border border-border-default bg-surface px-4 py-4">
        <p className="text-fg-secondary text-sm">无需 API key —— 复用你本地已登录的 CLI。</p>
        <p className="mt-3 text-fg-tertiary text-xs">先全局安装它的 CLI / ACP 适配器:</p>
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-elevated px-3 py-2 font-mono text-fg-secondary text-xs">
          npm i -g {provider.install}
        </pre>
        <p className="mt-3 text-fg-tertiary text-xs leading-relaxed">
          安装并登录后(如 <code>claude /login</code> / <code>codex login</code>),启用本项,
          即可在对话框的模型选择里选它。
        </p>
      </div>

      <LaunchField
        providerId={provider.id}
        field="command"
        label="Command"
        value={config.command ?? ''}
        placeholder={defaultCommand}
        hint="启动 ACP agent 的命令,留空用默认。"
      />
      <LaunchField
        providerId={provider.id}
        field="args"
        label="Arguments"
        value={config.args ?? ''}
        placeholder={defaultArgs || 'e.g. --acp --model …'}
        hint="空格分隔的命令行参数,留空用默认。"
      />
    </div>
  );
}

function LaunchField({
  providerId,
  field,
  label,
  value,
  placeholder,
  hint,
}: {
  providerId: string;
  field: 'command' | 'args';
  label: string;
  value: string;
  placeholder: string;
  hint: string;
}): React.JSX.Element {
  const utils = trpc.useUtils();
  const [v, setV] = useState(value);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const updateConfig = trpc.providers.updateConfig.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setV(e.target.value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateConfig.mutate({ id: providerId, partial: { [field]: e.target.value.trim() } });
    }, 600);
  };

  return (
    <div>
      <label
        className="mb-1.5 block font-medium text-fg-secondary text-xs"
        htmlFor={`${field}-${providerId}`}
      >
        {label} <span className="text-fg-tertiary">(Optional)</span>
      </label>
      <input
        id={`${field}-${providerId}`}
        type="text"
        value={v}
        onChange={handleChange}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border-default bg-elevated px-3 py-2 font-mono text-fg-primary text-sm outline-none placeholder:text-fg-disabled focus:border-accent"
      />
      <p className="mt-1.5 text-fg-tertiary text-xs">{hint}</p>
    </div>
  );
}
