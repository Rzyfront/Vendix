/**
 * Utilidad genérica de filtros fijables ("Fijar").
 *
 * Semántica (igual que órdenes y el dashboard):
 * - El set de filtros se guarda en localStorage POR TIENDA bajo `prefix + storeId`.
 * - Se restaura SOLO si la URL no trae filtros; si los trae, la URL manda.
 * - El pin en sí NO cuenta como filtro activo (no acota datos).
 * - Desmarcar el pin borra la clave (`persistPinnedFilters(key, null)`).
 * - Todo acceso a storage es best-effort: puede lanzar (modo privado, cuota,
 *   datos de sitio bloqueados) y nunca debe romper el filtrado.
 */

/** Clave de localStorage por pantalla y tienda. `null` si aún no hay tienda. */
export function buildPinnedFiltersKey(
  prefix: string,
  storeId: string | number | null | undefined,
): string | null {
  if (storeId === null || storeId === undefined || storeId === '') return null;
  return `${prefix}${storeId}`;
}

/** Lee el set fijado; `null` si no hay, está corrupto o el storage falla. */
export function readPinnedFilters<T>(key: string | null): T | null {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** Persiste el set fijado; `null` borra la clave. Best-effort. */
export function persistPinnedFilters<T>(
  key: string | null,
  value: T | null,
): void {
  if (!key || typeof localStorage === 'undefined') return;
  try {
    if (value === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage lleno o no disponible: fijar es best-effort.
  }
}
