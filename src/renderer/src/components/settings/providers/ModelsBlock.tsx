import { Download } from 'lucide-react';

/**
 * Models region of the provider detail pane. The Fetch button is wired
 * to the backend in C.2.b; for now it's a styled placeholder so the layout
 * is real.
 */
export function ModelsBlock({
  hasCredentials,
  models,
}: {
  hasCredentials: boolean;
  models: string[];
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-fg-secondary text-xs">Models</h3>
        <button
          type="button"
          disabled
          title="Fetch 接口在 C.2.b 接入"
          className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-elevated px-2.5 py-1 text-fg-secondary text-xs hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="size-[12px]" />
          Fetch
        </button>
      </div>
      {models.length === 0 ? (
        <div className="rounded-lg border border-border-default border-dashed bg-surface px-6 py-8 text-center">
          <p className="text-fg-tertiary text-sm">
            {hasCredentials ? '点 Fetch 拉取可用模型。' : '填好 API key 后即可 Fetch 模型。'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {models.map((m) => (
            <li
              key={m}
              className="rounded-md border border-border-default bg-elevated px-3 py-2 font-mono text-fg-primary text-sm"
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
