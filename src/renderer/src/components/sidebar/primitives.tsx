import { Tooltip } from '../Tooltip';

/**
 * A small icon button revealed on row hover (pin / archive / new chat). It can
 * sit inside a row's <Link>, so it cancels the click's navigation.
 */
export function RowAction({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        aria-label={title}
        onClick={(e) => {
          // Rows can sit inside a <Link>: keep the click from navigating.
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        className="flex items-center p-0.5 text-fg-tertiary hover:text-fg-primary"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/** A top-of-sidebar nav row (e.g. Search), styled like the New Chat link. */
export function SbNavItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

/** A section header (Pinned / Projects / Chats) with hover-revealed actions. */
export function SbSection({
  label,
  className,
  hoverActions,
}: {
  label: string;
  className?: string;
  hoverActions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`group flex items-center px-3 pt-3 pb-1 font-medium text-fg-tertiary text-sm ${className ?? ''}`}
    >
      <span className="flex-1">{label}</span>
      <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {hoverActions}
      </span>
    </div>
  );
}

/** A section-header icon button (e.g. add project, new chat). */
export function SbIconButton({
  title,
  icon,
  small = false,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  small?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      className={`flex items-center text-fg-tertiary hover:text-fg-primary ${small ? 'p-0.5' : 'p-1'}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {icon}
    </button>
  );
}
