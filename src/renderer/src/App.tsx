import { useEffect, useState } from 'react';
import { trpc } from './lib/trpc';

type Pong = Awaited<ReturnType<typeof trpc.ping.query>>;

function App(): React.JSX.Element {
  const [pong, setPong] = useState<Pong | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    trpc.ping
      .query()
      .then(setPong)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-3">
      <h1 className="text-3xl font-semibold tracking-tight text-fg-primary">Atrium</h1>
      <p className="text-sm text-fg-tertiary">Personal AI workspace · v0.0.1</p>

      <div className="mt-6 flex items-center gap-2 rounded-md border border-border-default bg-elevated px-3 py-1.5 text-xs text-fg-secondary shadow-sm">
        <span
          className={`size-1.5 rounded-full ${pong ? 'bg-accent' : err ? 'bg-danger' : 'bg-fg-disabled'}`}
        />
        {pong ? (
          <span>
            tRPC OK · electron {pong.electron} · node {pong.node}
          </span>
        ) : err ? (
          <span>tRPC error: {err}</span>
        ) : (
          <span>contacting main…</span>
        )}
      </div>
    </main>
  );
}

export default App;
