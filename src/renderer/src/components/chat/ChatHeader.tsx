import { useSidebarStore } from '../../state/sidebar-store';

export function ChatHeader({ title }: { title: string }): React.JSX.Element {
  // Left-aligned; when collapsed, pad clear of the floating toggle at top-left.
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <header
      className={`app-drag flex shrink-0 items-center border-border-default border-b py-3 pr-6 transition-[padding] duration-200 ${
        collapsed ? 'pl-[120px]' : 'pl-6'
      }`}
    >
      <h1 className="app-no-drag min-w-0 truncate font-medium text-fg-primary text-md">{title}</h1>
    </header>
  );
}
