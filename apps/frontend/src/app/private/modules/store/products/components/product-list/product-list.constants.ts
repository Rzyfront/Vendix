/**
 * QUI-729 — defaults unicos del listado de productos.
 *
 * Antes, el mismo default vivía escrito a mano en cuatro sitios:
 *   - `products.component.ts` (inicializacion de `currentFilters`).
 *   - `product-list.component.ts` (inicializacion de `filterValues`).
 *   - `product-list.component.ts emitQuery` (fallback si el dropdown esta vacio).
 *   - `product-list.component.ts clearFilters` (cuando "Limpiar todo" restaura).
 *
 * Cuatro copias permitian que la UI y la peticion se desincronizaran sin
 * que nadie lo notara: el dropdown mostraba "Productos" (default) mientras
 * la peticion salia sin `is_ingredient`, devolviendo 106. La constante
 * unica elimina la posibilidad de divergencia.
 */

/**
 * Estado inicial de `filterValues` en el dropdown del listado. Las pestañas
 * Venta · Insumos · Uso interno reemplazaron el filtro tri-estado
 * Productos / Insumos / Todos, así que el dropdown arranca vacío.
 */
export const PRODUCT_LIST_DEFAULT_FILTER_VALUES = {} as const;

/**
 * Query inicial que el padre (ProductsComponent) usa para que la primera
 * peticion ya llegue filtrada (evita la carrera de QUI-729 contra
 * `afterNextRender(() => this.emitQuery())` del hijo). La pestaña por
 * defecto es Venta.
 */
export const PRODUCT_LIST_DEFAULT_QUERY = {
  usage_nature: 'sale',
} as const;
