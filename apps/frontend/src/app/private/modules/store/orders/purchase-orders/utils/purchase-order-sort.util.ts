/**
 * Ordenamiento del listado de Órdenes de Compra.
 *
 * El sort dejó de ser un `<select>` suelto al lado del buscador: ahora vive
 * dentro de `app-options-dropdown` como una `FilterConfig` más, y la elección
 * del usuario se cachea en el navegador para que sobreviva entre sesiones.
 *
 * El value viaja compuesto (`'order_date:desc'`) porque `FilterConfig` sólo
 * transporta un `string` por filtro, y el backend necesita DOS query params
 * (`sort_by` + `sort_order`). `parseSortValue` / `buildSortValue` son el
 * puente entre ambos contratos.
 *
 * CONTRATO CERRADO — `sort_by` es un enum en el backend
 * (`purchase-order-query.dto.ts`: order_date | next_payment_date |
 * supplier_name | total | status). Cualquier valor fuera del enum se rechaza
 * con 400, así que TODO lo que entra desde localStorage se valida contra
 * `PURCHASE_ORDER_SORT_OPTIONS` antes de usarse.
 */

/** Campos aceptados por el enum cerrado de `sort_by` en el backend. */
export type PurchaseOrderSortKey =
  | 'order_date'
  | 'next_payment_date'
  | 'supplier_name'
  | 'total'
  | 'status';

export type PurchaseOrderSortDir = 'asc' | 'desc';

/** Llave del caché de cliente. Namespaced para no chocar con otros módulos. */
export const PURCHASE_ORDER_SORT_STORAGE_KEY = 'vendix.pop.sortBy';

/** Default del listado: "Más recientes primero". */
export const PURCHASE_ORDER_SORT_DEFAULT = 'order_date:desc';

/**
 * Opciones expuestas en el dropdown. El `value` es siempre `campo:dirección`
 * para que una sola elección fije criterio Y sentido — el usuario nunca ve
 * dos controles separados.
 */
export const PURCHASE_ORDER_SORT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'order_date:desc', label: 'Más recientes primero' },
  { value: 'order_date:asc', label: 'Más antiguas primero' },
  { value: 'next_payment_date:asc', label: 'Próximo pago (asc)' },
  { value: 'supplier_name:asc', label: 'Proveedor (A-Z)' },
  { value: 'total:desc', label: 'Total (mayor a menor)' },
  { value: 'status:asc', label: 'Estado' },
];

/** ¿El value compuesto está dentro del catálogo permitido? */
export function isValidSortValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    PURCHASE_ORDER_SORT_OPTIONS.some((opt) => opt.value === value)
  );
}

/**
 * Descompone `'order_date:desc'` en los dos query params del backend.
 * Un value desconocido, vacío o `null` cae al default en vez de propagar
 * basura al enum cerrado.
 */
export function parseSortValue(value: string | null | undefined): {
  sortBy: PurchaseOrderSortKey;
  sortDir: PurchaseOrderSortDir;
} {
  const safe = isValidSortValue(value) ? value : PURCHASE_ORDER_SORT_DEFAULT;
  const [by, dir] = safe.split(':');
  return {
    sortBy: by as PurchaseOrderSortKey,
    sortDir: dir === 'asc' ? 'asc' : 'desc',
  };
}

/** Compone el value del dropdown a partir del estado del componente. */
export function buildSortValue(
  by: PurchaseOrderSortKey,
  dir: PurchaseOrderSortDir,
): string {
  return `${by}:${dir}`;
}

/**
 * Lee la preferencia cacheada. Devuelve `null` cuando no hay nada guardado,
 * cuando el valor guardado ya no pertenece al catálogo (opción renombrada o
 * eliminada en un release posterior), o cuando no hay `localStorage`
 * disponible (SSR / prerender / modo privado de Safari).
 */
export function loadSortPreference(): string | null {
  try {
    const stored = localStorage.getItem(PURCHASE_ORDER_SORT_STORAGE_KEY);
    return isValidSortValue(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Persiste la preferencia. Falla en silencio a propósito: quedarse sin cuota,
 * correr en SSR o tener el storage bloqueado NO debe romper el listado — el
 * peor caso es que la elección no sobreviva al refresh.
 */
export function saveSortPreference(value: string): void {
  if (!isValidSortValue(value)) return;
  try {
    localStorage.setItem(PURCHASE_ORDER_SORT_STORAGE_KEY, value);
  } catch {
    // SSR / modo privado / quota exceeded — sin efecto observable.
  }
}
