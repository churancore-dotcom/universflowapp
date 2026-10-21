import PageLoader from "./components/PageLoader";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // ported from pre-migration src/App.tsx QueryClient defaultOptions
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPendingComponent: PageLoader,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPreloadStaleTime: 5 * 60 * 1000,
  });

  return router;
};
