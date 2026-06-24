import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { Tooltip } from '../../Tooltip';

/**
 * Read-only project indicator for a thread's composer: a project can't change
 * once the thread exists, so this shows the thread's working directory and is
 * disabled. Hover reveals the directory and the why.
 */
export function ProjectBadge({ projectId }: { projectId: string | null }): React.JSX.Element {
  const { t } = useTranslation();
  const { data: projects } = trpc.projects.list.useQuery();
  const project = projectId ? (projects?.find((p) => p.id === projectId) ?? null) : null;
  const active = project !== null;

  return (
    <Tooltip
      content={
        <div className="max-w-[260px]">
          {active ? (
            <>
              <div className="font-medium text-fg-primary">{project.name}</div>
              <div className="break-all text-fg-tertiary">{project.path}</div>
            </>
          ) : (
            <div className="text-fg-secondary">{t('composer.noProjectDesc')}</div>
          )}
          <div className="mt-1 border-border-default border-t pt-1 text-fg-tertiary">
            {t('composer.projectLocked')}
          </div>
        </div>
      }
    >
      <button
        type="button"
        aria-disabled
        className="flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 text-fg-tertiary text-sm"
      >
        <Folder className="size-[13px] shrink-0" />
        <span className="max-w-[160px] truncate">
          {active ? project.name : t('composer.noProject')}
        </span>
      </button>
    </Tooltip>
  );
}
