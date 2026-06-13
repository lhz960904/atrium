import './assets/styles.css';
import './i18n'; // initialize i18next (best-guess language; useLanguage corrects from settings)
import './state/theme-store'; // initialize theme from persisted store + system listener

import { QueryClientProvider } from '@tanstack/react-query';
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { ipcLink } from 'electron-trpc/renderer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient } from './lib/query-client';
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
