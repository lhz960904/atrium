import * as Popover from '@radix-ui/react-popover';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ModelGroup } from '../lib/use-chat-model';
import { ProviderIcon } from './settings/providers/ProviderIcon';

export type ModelValue = { providerId: string; modelId: string } | null;

type ModelPickerProps = {
  /** Current selection, or null (nothing chosen / inherit). */
  value: ModelValue;
  onChange: (value: ModelValue) => void;
  groups: ModelGroup[];
  /** Trigger chrome: quiet inline (composer) vs bordered field (settings form). */
  variant?: 'inline' | 'field';
  /** When set, offers an "inherit" row that selects null, and labels an empty value. */
  inheritLabel?: string;
  /** Trigger label when value is null and there's no inherit option. */
  placeholder?: string;
  onSelected?: () => void;
};

/**
 * Model selector: a popover grouping models by provider (brand icons, search).
 * Controlled — the caller owns the value, so it drives both the composer (bound
 * to the active chat model) and the subagent form (a pinned model, or inherit).
 * Built on Radix Popover, which handles collision-aware placement, width, focus
 * and click-away.
 */
export function ModelPicker({
  value,
  onChange,
  groups,
  variant = 'inline',
  inheritLabel,
  placeholder = '选择模型',
  onSelected,
}: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  // An external (ACP) provider has no meaningful model id, so show its name.
  const selectedGroup = value ? groups.find((g) => g.providerId === value.providerId) : undefined;
  const label = value
    ? selectedGroup?.external
      ? selectedGroup.providerName
      : value.modelId
    : (inheritLabel ?? placeholder);
  const triggerClass =
    variant === 'field'
      ? 'flex w-full items-center justify-between gap-1.5 rounded-lg border border-border-default bg-surface px-3 py-2 text-fg-primary text-sm hover:border-border-strong'
      : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-fg-tertiary text-sm hover:bg-elevated hover:text-fg-secondary';
  // field: match the trigger width; inline (composer): a fixed, right-aligned menu.
  const widthClass = variant === 'field' ? 'w-[var(--radix-popover-trigger-width)]' : 'w-80';

  const pick = (v: ModelValue): void => {
    onChange(v);
    setOpen(false);
    onSelected?.();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={triggerClass}>
          <span className={variant === 'field' && !value ? 'text-fg-tertiary' : undefined}>
            {label}
          </span>
          <ChevronDown className="size-[14px] shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={variant === 'field' ? 'start' : 'end'}
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={`z-50 flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden rounded-lg border border-border-default bg-elevated shadow-lg ${widthClass}`}
        >
          <ModelList groups={groups} value={value} inheritLabel={inheritLabel} onPick={pick} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelList({
  groups,
  value,
  inheritLabel,
  onPick,
}: {
  groups: ModelGroup[];
  value: ModelValue;
  inheritLabel?: string;
  onPick: (value: ModelValue) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return (
      groups
        // External providers match by name (they have no real model to search).
        .map((g) =>
          g.external ? g : { ...g, models: g.models.filter((m) => m.toLowerCase().includes(q)) },
        )
        .filter((g) =>
          g.external ? g.providerName.toLowerCase().includes(q) : g.models.length > 0,
        )
    );
  }, [groups, query]);

  if (groups.length === 0) {
    return (
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
    );
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-3 py-2">
        <Search className="size-[14px] shrink-0 text-fg-tertiary" />
        <input
          // biome-ignore lint/a11y/noAutofocus: focuses the search when the popover opens
          autoFocus
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模型…"
          className="flex-1 border-0 bg-transparent text-fg-primary text-sm outline-0 placeholder:text-fg-disabled"
        />
      </div>
      <ul style={{ scrollbarGutter: 'stable' }} className="min-h-0 flex-1 overflow-y-auto p-1">
        {inheritLabel && query.length === 0 && (
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-surface-strong ${
                value === null ? 'text-fg-primary' : 'text-fg-secondary'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{inheritLabel}</span>
              {value === null && <Check className="size-[14px] shrink-0 text-accent" />}
            </button>
          </li>
        )}
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-fg-tertiary text-sm">无匹配</li>
        ) : (
          filtered.map((g) =>
            g.external ? (
              // ACP provider: one row showing the provider name (no model sub-item).
              <li key={g.providerId}>
                <button
                  type="button"
                  onClick={() => onPick({ providerId: g.providerId, modelId: g.models[0] ?? '' })}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-surface-strong ${
                    value?.providerId === g.providerId ? 'text-fg-primary' : 'text-fg-secondary'
                  }`}
                >
                  <ProviderIcon id={g.providerId} className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{g.providerName}</span>
                  {value?.providerId === g.providerId && (
                    <Check className="size-[14px] shrink-0 text-accent" />
                  )}
                </button>
              </li>
            ) : (
              <li key={g.providerId}>
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
                  <ProviderIcon id={g.providerId} className="size-3.5" />
                  {g.providerName}
                </div>
                {g.models.map((m) => {
                  const isSel = value?.providerId === g.providerId && value?.modelId === m;
                  return (
                    <button
                      type="button"
                      key={m}
                      onClick={() => onPick({ providerId: g.providerId, modelId: m })}
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
            ),
          )
        )}
      </ul>
    </>
  );
}
