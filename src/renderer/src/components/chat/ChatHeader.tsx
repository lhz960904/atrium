export function ChatHeader({ title }: { title: string }): React.JSX.Element {
  // Bar drags the window; title + future controls opt out via `app-no-drag`.
  return (
    <header className="app-drag flex shrink-0 items-center gap-2 border-border-default border-b px-6 py-3">
      <h1 className="app-no-drag min-w-0 truncate font-medium text-fg-primary text-md">{title}</h1>
    </header>
  );
}
