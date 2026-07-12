import { useShallow } from 'zustand/react/shallow';

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
  // zustand v5 compares snapshots with Object.is; a selector that builds a
  // new object each render is never equal, causing a getSnapshot loop.
  // useShallow keeps the snapshot stable across unrelated store updates.
  return useTenantStore(
    useShallow((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
      storeSlug: s.storeSlug,
      organizationId: s.organizationId,
      organizationName: s.organizationName,
    })),
  );
}