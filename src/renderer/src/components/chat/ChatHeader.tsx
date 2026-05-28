export function ChatHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center gap-2 border-border-default border-b px-6 py-3">
      <h1 className="truncate font-medium text-fg-primary text-md">{title}</h1>
    </header>
  );
}
