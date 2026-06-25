import { useTenantStore } from './tenant.store';

/**
 * Selector tipado para el tenant activo.
 *
 * Centraliza el shape del estado del tenant en un solo lugar para que los
 * componentes no tengan que conocer los nombres de los campos del store.
 *
 * Uso:
 *   const { storeId, storeName, storeSlug } = useActiveStore();
 *   if (storeSlug) { ... }
 */
export interface ActiveStoreInfo {
  storeId: string | null;
  storeName: string | null;
  storeSlug: string | null;
  organizationId: string | null;
  organizationName: string | null;
}

export function useActiveStore(): ActiveStoreInfo {
  return useTenantStore((s) => ({
    storeId: s.storeId,
    storeName: s.storeName,
    storeSlug: s.storeSlug,
    organizationId: s.organizationId,
    organizationName: s.organizationName,
  }));
}