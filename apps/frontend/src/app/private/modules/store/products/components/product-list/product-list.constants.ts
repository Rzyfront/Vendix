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
 * Estado inicial de `filterValues` en el dropdown del listado.
 * El dropdown trabaja con la representacion string `'products' | 'ingredients' | 'all'`,
 * que `emitQuery` traduce al booleano de la query.
 */
export const PRODUCT_LIST_DEFAULT_FILTER_VALUES = {
  is_ingredient: 'products',
} as const;

/**
 * Query inicial que el padre (ProductsComponent) usa para que la primera
 * peticion ya llegue filtrada. Esto evita la carrera contra
 * `afterNextRender(() => this.emitQuery())` del hijo, que era la causa
 * del bug QUI-729: dos peticiones concurrentes, la del padre sin filtro
 * y la del hijo filtrada, compiten por escribir `this.products`. Como
 * cada `loadProducts()` abre su propio `subscribe` y escribe
 * `this.products`, se queda el que responde ultimo -- sin garantia de
 * orden.
 *
 * El padre inicializa `currentFilters` con ESTE valor antes de la
 * primera consulta y el hijo ya no necesita reemitir despues del render.
 */
export const PRODUCT_LIST_DEFAULT_QUERY = {
  is_ingredient: false,
} as const;
