import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Folder, FolderX, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

/**
 * Picks which project (working directory) a new chat starts in — a folder button
 * in the composer toolbar that highlights when a project is selected and opens a
 * dropdown of projects. null = projectless (a temporary working directory).
 */
export function ProjectPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const { data: projects } = trpc.projects.list.useQuery();
  const pickDirectory = trpc.projects.pickDirectory.useMutation();
  const addProject = trpc.projects.add.useMutation({
    onSuccess: ({ id }) => {
      utils.projects.list.invalidate();
      onChange(id);
      setOpen(false);
    },
  });

  const selectDirectory = async (): Promise<void> => {
    const path = await pickDirectory.mutateAsync();
    if (path) addProject.mutate({ path });
  };
  const pick = (id: string | null) => (): void => {
    onChange(id);
    setOpen(false);
  };
  const selected = projects?.find((p) => p.id === value) ?? null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t('composer.workInProject')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-fg-tertiary text-sm hover:bg-elevated hover:text-fg-secondary"
        >
          <Folder className="size-[13px] shrink-0" />
          <span className="max-w-[160px] truncate">
            {selected ? selected.name : t('composer.noProject')}
          </span>
          <ChevronDown className="size-[12px] shrink-0 opacity-70" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-72 overflow-hidden rounded-xl border border-border-default bg-elevated shadow-lg"
        >
          <div className="px-3 pt-3 pb-2.5">
            <div className="font-medium text-fg-primary text-sm">{t('composer.projectsTitle')}</div>
            <div className="mt-0.5 text-fg-tertiary text-xs leading-snug">
              {t('composer.projectsSubtitle')}
            </div>
          </div>

          <div className="max-h-[280px] overflow-y-auto border-border-default border-t p-1">
            <Item
              icon={<FolderX className="size-[15px] shrink-0 text-fg-tertiary" />}
              name={t('composer.noProject')}
              desc={t('composer.noProjectDesc')}
              selected={value === null}
              onClick={pick(null)}
            />
            {projects?.map((p) => (
              <Item
                key={p.id}
                icon={<Folder className="size-[15px] shrink-0 text-fg-tertiary" />}
                name={p.name}
                desc={p.path}
                selected={value === p.id}
                onClick={pick(p.id)}
              />
            ))}
          </div>

          <div className="border-border-default border-t p-1">
            <button
              type="button"
              onClick={selectDirectory}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-fg-secondary text-sm hover:bg-surface-strong"
            >
              <Plus className="size-[15px] shrink-0 text-fg-tertiary" />
              {t('composer.selectDirectory')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Item({
  icon,
  name,
  desc,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${selected ? 'bg-surface-strong' : 'hover:bg-surface-strong'}`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-fg-primary text-sm ${selected ? 'font-medium' : ''}`}>
          {name}
        </div>
        <div className="truncate text-fg-tertiary text-xs">{desc}</div>
      </div>
      {selected && <Check className="size-[14px] shrink-0 text-accent" />}
    </button>
  );
}
