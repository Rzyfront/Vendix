/**
 * QUI-1030: búsqueda en servidor del catálogo en los selectores de "Agregar
 * producto" de Estaciones (check-in y detalle de la atención).
 */

/** Opciones visibles al abrir el selector, sin término de búsqueda. */
export const CATALOG_INITIAL_LIMIT = 5;
/** Opciones visibles cuando hay término (nombre o SKU). */
export const CATALOG_SEARCH_LIMIT = 10;
/**
 * Filas pedidas al servidor: holgura sobre lo visible porque el cliente aún
 * descarta servicios/insumos según la pantalla.
 */
export const CATALOG_FETCH_LIMIT = 20;

/**
 * Une productos nuevos a la caché por id (los nuevos reemplazan a los viejos).
 * La caché sostiene precios y variantes de lo ya elegido aunque el resultado
 * de búsqueda cambie.
 */
export function mergeById<T extends { id: number }>(cache: T[], incoming: T[]): T[] {
  if (!incoming.length) return cache;
  const byId = new Map(cache.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}
