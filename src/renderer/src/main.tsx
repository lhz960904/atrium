import './assets/styles.css';
import './state/theme-store'; // initialize theme from persisted store + system listener

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { ipcLink } from 'electron-trpc/renderer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { trpc } from './lib/trpc';
import { routeTree } from './routeTree.gen';

// Hash history so routing works when the packaged app loads the renderer over
// file:// — browser history would read the on-disk index.html path as the route
// and resolve to Not Found.
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [ipcLink()],
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
