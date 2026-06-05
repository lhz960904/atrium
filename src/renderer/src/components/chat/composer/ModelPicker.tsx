import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatModel } from '../../../lib/use-chat-model';
import { ProviderIcon } from '../../settings/providers/ProviderIcon';

/**
 * Composer model selector. The trigger shows the model name only (no provider
 * icon — keeps the composer chrome quiet); the popover groups models by
 * provider with colored brand icons, indented rows, search, and an empty-state
 * link to Settings → Providers.
 */
export function ModelPicker({ onSelected }: { onSelected?: () => void }): React.JSX.Element {
  const { selected, groups } = useChatModel();
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState(420);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Popover opens upward; cap its height to the space above the trigger so a
  // long list never overflows the viewport top (home composer sits mid-screen).
  const toggle = (): void => {
    if (!open) {
      const top = triggerRef.current?.getBoundingClientRect().top ?? window.innerHeight;
      setMaxHeight(Math.max(220, Math.min(420, top - 16)));
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-fg-tertiary text-sm hover:bg-elevated hover:text-fg-secondary"
      >
        <span>{selected?.modelId ?? '选择模型'}</span>
        <ChevronDown className="size-[14px]" />
      </button>
      {open && (
        <>
          {/* backdrop: click-away closes */}
          <button
            type="button"
            aria-label="关闭"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <Popover
            groups={groups}
            selected={selected}
            maxHeight={maxHeight}
            onClose={() => setOpen(false)}
            onSelected={onSelected}
          />
        </>
      )}
    </div>
  );
}

function Popover({
  groups,
  selected,
  maxHeight,
  onClose,
  onSelected,
}: {
  groups: ReturnType<typeof useChatModel>['groups'];
  selected: ReturnType<typeof useChatModel>['selected'];
  maxHeight: number;
  onClose: () => void;
  onSelected?: () => void;
}): React.JSX.Element {
  const { setSelected } = useChatModel();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          models: g.models.filter((m) => m.toLowerCase().includes(query.toLowerCase())),
        }))
        .filter((g) => g.models.length > 0),
    [groups, query],
  );

  return (
    <div
      style={{ maxHeight }}
      className="absolute right-0 bottom-[calc(100%+8px)] z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-border-default bg-elevated shadow-lg"
    >
      {groups.length === 0 ? (
        <div className="px-6 py-8 text-center text-fg-tertiary text-sm">
          没有已启用的模型。
          <br />
          <Link
            to="/settings/$section"
            params={{ section: 'providers' }}
            className="text-accent hover:underline"
          >
            去 Settings → Providers 配置 ↗
          </Link>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-3 py-2">
            <Search className="size-[14px] shrink-0 text-fg-tertiary" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              className="flex-1 border-0 bg-transparent text-fg-primary text-sm outline-0 placeholder:text-fg-disabled"
            />
          </div>
          <ul style={{ scrollbarGutter: 'stable' }} className="min-h-0 flex-1 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-fg-tertiary text-sm">无匹配</li>
            ) : (
              filtered.map((g) => (
                <li key={g.providerId}>
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
                    <ProviderIcon id={g.providerId} className="size-3.5" />
                    {g.providerName}
                  </div>
                  {g.models.map((m) => {
                    const isSel = selected?.providerId === g.providerId && selected?.modelId === m;
                    return (
                      <button
                        type="button"
                        key={m}
                        onClick={() => {
                          setSelected({ providerId: g.providerId, modelId: m });
                          onClose();
                          onSelected?.();
                        }}
                        className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-3 pl-8 text-left text-sm hover:bg-surface-strong ${
                          isSel ? 'text-fg-primary' : 'text-fg-secondary'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{m}</span>
                        {isSel && <Check className="size-[14px] shrink-0 text-accent" />}
                      </button>
                    );
                  })}
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
