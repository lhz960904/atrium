import { QueryClient } from '@tanstack/react-query';

/** The app's single QueryClient. Lives here (not in main.tsx) so non-React code
 *  — e.g. the chat store's onData — can invalidate queries off a stream event. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
