import { router } from 'expo-router';
import { getQueryClient } from '@/core/api/query-client';
import { AuthService } from './auth.service';
import {
  toastError,
  toastInfo,
  toastSticky,
  useToastStore,
} from '@/shared/components/toast/toast.store';

/**
 * Query keys de los dashboards que se benefician de un refetch explícito
 * después de un switch de entorno.
 *
 * **Mantener sincronizado** con los `queryKey` reales de:
 *   - apps/mobile/app/(store-admin)/dashboard.tsx
 *   - apps/mobile/app/(org-admin)/dashboard.tsx
 *
 * La invalidación dirigida (en lugar de `qc.clear()` global) preserva queries
 * no relacionadas (perfil, theming, prefs) y a la vez garantiza que las
 * queries del nuevo dashboard NO vean datos cacheados del entorno anterior.
 */
export const STORE_AWARE_QUERY_KEYS: readonly (readonly string[])[] = [
  ['sales-summary'],
  ['sales-trends'],
  ['store-stats'],
  ['inventory-summary'],
  ['sales-by-channel'],
  ['products-list'],
  ['customers-list'],
  ['orders-list'],
  ['dashboard-summary'],
  ['org-stats-summary'],
  ['unread-notifications-count'],
] as const;

export type SwitchTarget =
  | { kind: 'ORG_ADMIN' }
  | { kind: 'STORE_ADMIN'; storeSlug: string; storeName?: string };

/**
 * Switch centralizado de entorno. Encapsula:
 *
 *   1. Toast sticky mientras dura la operación ("Cargando datos de X…").
 *   2. Cambio de token + tenant vía `AuthService.switchEnvironment` (que a su
 *      vez actualiza `useAuthStore` → `useTenantStore`).
 *   3. Invalidación dirigida de queries store-aware (NO `clear()` global).
 *   4. Navegación al dashboard correspondiente.
 *   5. Toast de éxito vía `useStoreChangeNotifier` (side-effect global).
 *
 * Reemplaza los 3 call-sites previos:
 *   - apps/mobile/src/features/user/user-dropdown-modal.tsx (líneas 121-137, 139-158)
 *   - apps/mobile/src/shared/layouts/drawer-menu.tsx (líneas 413-435)
 *   - apps/mobile/app/(org-admin)/stores/index.tsx
 *
 * @throws Re-emite el error original si `AuthService.switchEnvironment` falla.
 */
export async function performStoreSwitch(target: SwitchTarget): Promise<void> {
  const qc = getQueryClient();
  const toastStore = useToastStore.getState();

  // 1) Sticky toast mientras dura el switch.
  const loadingMsg =
    target.kind === 'ORG_ADMIN'
      ? 'Volviendo al panel de organización…'
      : `Cargando datos de ${target.storeName ?? target.storeSlug}…`;
  toastSticky(loadingMsg);

  // Capturamos el ID del sticky para poder removerlo de forma dirigida al
  // terminar — evita que el sticky quede colgado si el notifier externo no
  // está montado (ej: pantallas sin AdminShell).
  //
  // IMPORTANTE: leer el state DESPUÉS de `toastSticky` — si capturamos
  // `toastStore.toasts` antes de agregar el sticky, estaríamos tomando el id
  // de un toast anterior y `removeToast(stickyId)` removería otro toast
  // dejando el sticky colgado (bug histórico).
  const stickyId = useToastStore.getState().toasts.at(-1)?.id;

  try {
    // 2) Cambio de token + tenant en el store.
    if (target.kind === 'ORG_ADMIN') {
      await AuthService.switchEnvironment('ORG_ADMIN');
    } else {
      await AuthService.switchEnvironment('STORE_ADMIN', target.storeSlug);
    }

    // 3) Limpieza dirigida del cache ANTES de navegar — sólo queries del
    // entorno anterior. NO usamos `cancelQueries()` (puede dejar queries en
    // estado fetching que bloquean al re-mount) ni `invalidateQueries()`
    // global (afecta queries que no son del dashboard: perfil, theming).
    // El dashboard del nuevo entorno re-fetchea gracias a
    // `refetchOnMount: 'always'` configurado en sus queries críticas.
    for (const key of STORE_AWARE_QUERY_KEYS) {
      qc.removeQueries({ queryKey: key, exact: false });
    }

    // 4) Cierra el sticky ANTES de navegar — evita que el toast quede visible
    // sobre el dashboard destino durante el refetch.
    if (stickyId) toastStore.removeToast(stickyId);

    // 5) Toast de éxito inmediato (no depende del useStoreChangeNotifier).
    const successMsg =
      target.kind === 'ORG_ADMIN'
        ? 'Panel de organización activado'
        : `Cambiaste a ${target.storeName ?? target.storeSlug}`;
    toastInfo(successMsg, 1500);

    // 6) Navegación al dashboard del entorno destino.
    const route =
      target.kind === 'ORG_ADMIN'
        ? ('/(org-admin)/dashboard' as const)
        : ('/(store-admin)/dashboard' as const);
    router.replace(route as never);
  } catch (error: unknown) {
    if (stickyId) toastStore.removeToast(stickyId);
    const msg =
      (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (error as { message?: string })?.message ||
      'No se pudo cambiar de entorno';
    toastError(msg);
    throw error;
  }
}