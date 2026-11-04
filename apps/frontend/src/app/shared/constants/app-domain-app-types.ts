/**
 * Apps F5: `app_type` values a store domain can serve, as the domain modals
 * show them. The app types of the apps (`STORE_HOME` … `STORE_BOOKING`) only
 * apply to store domains, and the backend accepts them only when the store
 * has that app published (`STORE_APPS_016`). Mirror of
 * `apps/backend/src/domains/store/apps/shared/app-domain-aliases.ts`.
 */
export interface AppTypeOption {
  value: string;
  label: string;
}

/** The store app types every store domain could already serve. */
export const BASE_STORE_APP_TYPE_OPTIONS: readonly AppTypeOption[] = [
  { value: 'STORE_ECOMMERCE', label: 'E-commerce' },
  { value: 'STORE_LANDING', label: 'Landing de tienda' },
  { value: 'STORE_ADMIN', label: 'Admin de tienda' },
];

/** App types that belong to an app of the Apps module. */
export const APP_ONLY_APP_TYPE_OPTIONS: readonly AppTypeOption[] = [
  { value: 'STORE_HOME', label: 'Inicio de tienda' },
  { value: 'STORE_PRODUCT_PAGE', label: 'Página de producto' },
  { value: 'STORE_SERVICE_PAGE', label: 'Página de servicios' },
  { value: 'STORE_BOOKING', label: 'Reservas' },
];

/** A domain serving these never moves to an app (backend `STORE_APPS_017`). */
export const PROTECTED_APP_TYPES: readonly string[] = ['STORE_ECOMMERCE', 'STORE_ADMIN'];

/**
 * Options of the "Aplicación destino" selector for a store domain. A domain
 * that serves the online store or the admin is not offered the apps.
 */
export function storeAppTypeOptions(currentAppType?: string | null): AppTypeOption[] {
  return currentAppType && PROTECTED_APP_TYPES.includes(currentAppType)
    ? [...BASE_STORE_APP_TYPE_OPTIONS]
    : [...BASE_STORE_APP_TYPE_OPTIONS, ...APP_ONLY_APP_TYPE_OPTIONS];
}

/** Label of an app type of an app, or `null` for any other app type. */
export function appOnlyAppTypeLabel(appType: string | null | undefined): string | null {
  return APP_ONLY_APP_TYPE_OPTIONS.find((o) => o.value === appType)?.label ?? null;
}
