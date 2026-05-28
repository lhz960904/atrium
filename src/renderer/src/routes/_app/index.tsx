import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/')({
  component: HomeView,
});

function HomeView(): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <h1 className="text-3xl font-semibold tracking-tight text-fg-primary">Atrium</h1>
      <p className="text-sm text-fg-tertiary">
        main view · empty state placeholder · Step 1.3 待做
      </p>
    </div>
  );
}
