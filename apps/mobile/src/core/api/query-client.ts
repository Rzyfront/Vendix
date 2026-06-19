import { QueryClient } from '@tanstack/react-query';

/**
 * Singleton QueryClient compartido entre el RootLayout y cualquier parte de la app
 * que necesite invalidar o limpiar el cache (ej: al cambiar de entorno).
 */
let _queryClient: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (!_queryClient) {
    _queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 30_000,
          refetchOnWindowFocus: false,
        },
        mutations: {
          retry: false,
        },
      },
    });
  }
  return _queryClient;
}
