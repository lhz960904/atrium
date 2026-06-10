import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronRight, Package, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { skillSourceLabel } from '../../../lib/skill-source';
import { trpc } from '../../../lib/trpc';
import { Markdown } from '../../chat/Markdown';

type SkillItem = { name: string; description: string; source: string; body: string };

/**
 * Read-only list of discovered skills. All bodies load in one query up front
 * (local files), so expanding a row shows its SKILL.md instantly. No
 * enable/disable — every discovered skill is active; managing them is later.
 */
export function SkillsSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: skills, isLoading } = trpc.skills.all.useQuery();
  const [filter, setFilter] = useState('');

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills ?? [];
    return (skills ?? []).filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, filter]);

  if (isLoading) return <p className="text-fg-tertiary text-sm">{t('common.loading')}</p>;
  if (!skills || skills.length === 0) {
    return (
      <div className="rounded-lg border border-border-default border-dashed bg-surface px-6 py-12 text-center">
        <p className="text-fg-tertiary text-sm">
          {t('settings.skills.empty', {
            file: 'SKILL.md',
            dirA: '~/.agents/skills',
            dirB: '~/.claude/skills',
            dirC: '~/.codex/skills',
          })}
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className="relative mb-3">
        <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-fg-tertiary" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('settings.skills.filter', { count: skills.length })}
          className="w-full rounded-lg border border-border-default bg-surface py-2 pr-3 pl-9 text-fg-primary text-sm outline-0 placeholder:text-fg-disabled focus:border-accent"
        />
      </div>
      {matches.length === 0 ? (
        <p className="px-1 py-6 text-center text-fg-tertiary text-sm">
          {t('settings.skills.noMatch')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {matches.map((s) => (
            <SkillRow key={s.name} skill={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function SkillRow({ skill }: { skill: SkillItem }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border border-border-default bg-surface"
    >
      <Collapsible.Trigger asChild>
        <button type="button" className="block w-full px-4 py-3 text-left hover:bg-elevated">
          <div className="flex items-center gap-3">
            <Package className="size-4 shrink-0 text-fg-tertiary" />
            <span className="min-w-0 flex-1 truncate font-medium text-fg-primary text-sm">
              {skill.name}
            </span>
            <span className="shrink-0 text-fg-disabled text-xs">
              {skillSourceLabel(skill.source)}
            </span>
            <ChevronRight
              className={`size-4 shrink-0 text-fg-tertiary transition-transform ${open ? 'rotate-90' : ''}`}
            />
          </div>
          <p className="mt-1 pl-7 text-fg-tertiary text-xs">{skill.description}</p>
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="atrium-collapsible">
        <div className="max-h-[420px] overflow-y-auto border-border-default border-t px-4 py-3">
          {skill.body ? (
            <Markdown>{skill.body}</Markdown>
          ) : (
            <p className="text-fg-tertiary text-sm">{t('settings.skills.noContent')}</p>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
