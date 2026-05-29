import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';

export const Route = createFileRoute('/welcome')({
  component: WelcomeView,
});

function WelcomeView(): React.JSX.Element {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const setCompleted = trpc.settings.setHasCompletedWelcome.useMutation({
    onSuccess: () => {
      // Patch the cache so _app's gating sees the new flag on first render
      // after navigate; invalidate would resolve before the inactive query
      // refetches and bounce us back to /welcome.
      utils.settings.all.setData(undefined, (prev) => ({
        ...prev,
        hasCompletedWelcome: true,
      }));
      navigate({ to: '/' });
    },
  });

  return (
    <div className="flex h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[560px] text-center">
        <h1 className="mb-2 font-semibold text-3xl text-fg-primary tracking-tight">
          欢迎来到 Atrium
        </h1>
        <p className="mb-10 text-fg-tertiary text-sm">三段式 UI 待实装（A.2.b）。</p>
        <button
          type="button"
          onClick={() => setCompleted.mutate(true)}
          disabled={setCompleted.isLoading}
          className="rounded-md bg-accent px-5 py-2.5 text-fg-on-accent text-sm hover:bg-accent-hover disabled:opacity-40"
        >
          开始使用 Atrium →
        </button>
      </div>
    </div>
  );
}
