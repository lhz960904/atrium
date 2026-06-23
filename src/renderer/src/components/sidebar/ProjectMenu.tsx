import * as Popover from '@radix-ui/react-popover';
import { Archive, Ellipsis, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { toast } from '../../state/toast-store';
import type { ProjectItem } from './types';

const menuItem =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-fg-secondary text-sm hover:bg-surface-strong';

export function ProjectMenu({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const refreshProjects = (): void => {
    utils.projects.list.invalidate();
  };
  // Archive / delete cascade to the project's threads, so refresh both lists.
  const refreshAll = (): void => {
    utils.projects.list.invalidate();
    utils.threads.list.invalidate();
  };

  const pin = trpc.projects.pin.useMutation({ onSuccess: refreshProjects });
  const unpin = trpc.projects.unpin.useMutation({ onSuccess: refreshProjects });
  const rename = trpc.projects.rename.useMutation({ onSuccess: refreshProjects });
  const archive = trpc.projects.archive.useMutation({
    onSuccess: () => {
      refreshAll();
      toast.success(t('chat.archived'));
    },
  });
  const remove = trpc.projects.delete.useMutation({ onSuccess: refreshAll });

  // Close the menu, then run the action.
  const run = (fn: () => void) => (): void => {
    onOpenChange(false);
    fn();
  };
  const onPin = (): void => (project.pinned ? unpin : pin).mutate({ id: project.id });
  const onRename = (): void => {
    const next = window.prompt(t('sidebar.renameProject'), project.name)?.trim();
    if (next && next !== project.name) rename.mutate({ id: project.id, name: next });
  };
  const onArchive = (): void => {
    if (window.confirm(t('sidebar.archiveProjectConfirm'))) archive.mutate({ id: project.id });
  };
  const onDelete = (): void => {
    if (window.confirm(t('sidebar.deleteProjectConfirm'))) remove.mutate({ id: project.id });
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('chat.more')}
          className="flex items-center rounded p-0.5 text-fg-tertiary hover:text-fg-primary"
        >
          <Ellipsis className="size-[13px]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-44 rounded-lg border border-border-default bg-elevated p-1 shadow-lg"
        >
          <button type="button" onClick={run(onPin)} className={menuItem}>
            {project.pinned ? (
              <PinOff className="size-[14px] shrink-0 text-fg-tertiary" />
            ) : (
              <Pin className="size-[14px] shrink-0 text-fg-tertiary" />
            )}
            {project.pinned ? t('sidebar.unpin') : t('sidebar.pin')}
          </button>
          <button type="button" onClick={run(onRename)} className={menuItem}>
            <Pencil className="size-[14px] shrink-0 text-fg-tertiary" />
            {t('sidebar.renameProject')}
          </button>
          <button type="button" onClick={run(onArchive)} className={menuItem}>
            <Archive className="size-[14px] shrink-0 text-fg-tertiary" />
            {t('sidebar.archiveProject')}
          </button>
          <button type="button" onClick={run(onDelete)} className={`${menuItem} hover:text-danger`}>
            <Trash2 className="size-[14px] shrink-0 text-fg-tertiary" />
            {t('sidebar.deleteProject')}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
