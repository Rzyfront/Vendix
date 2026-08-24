/**
 * Predicado ÚNICO de «qué categorías de impuesto puede usar esta tienda».
 *
 * Existía por duplicado y las dos copias no decían lo mismo:
 *
 *   · `InvoiceScannerService.loadTaxCategoryRates` leía con `withoutScope()` y
 *     `OR: [{store_id}, {store_id: null}]` SIN acotar la organización, así que
 *     el catálogo de sugerencias de una tienda incluía las categorías globales
 *     de CUALQUIER otra organización.
 *   · `PurchaseOrdersService.create` validaba el mismo conjunto con el cliente
 *     CON alcance de tienda. `tax_categories` está en `store_scoped_models`, y
 *     `mergeScopedWhere` suma `store_id = <contexto>` al nivel superior del
 *     where: el `OR ... store_id: null` quedaba anulado por ese AND y las
 *     globales NUNCA pasaban.
 *
 * Resultado en producción: el escáner sugería una categoría de otra
 * organización y la creación de la orden la rechazaba con
 * «Una o más categorías de impuesto no existen para esta tienda».
 *
 * Quien use este helper debe leer con `withoutScope()`: la rama global
 * (`store_id IS NULL`) es invisible para el cliente con alcance de tienda.
 */
export interface TaxCategoryScopeWhere {
  OR: Array<{ store_id: number } | { store_id: null; organization_id: number }>;
}

export function buildTaxCategoryScopeWhere(
  storeId: number,
  organizationId?: number | null,
): TaxCategoryScopeWhere {
  const branches: TaxCategoryScopeWhere['OR'] = [{ store_id: storeId }];

  // La rama global solo se abre cuando sabemos DE QUIÉN es lo global. Sin
  // `organization_id` un `store_id: null` pelado dejaría entrar las categorías
  // de todos los inquilinos — que es justo el defecto que este helper cierra.
  if (typeof organizationId === 'number' && organizationId > 0) {
    branches.push({ store_id: null, organization_id: organizationId });
  }

  return { OR: branches };
}

/**
 * Ante empate de tasa, la categoría PROPIA de la tienda gana sobre la global
 * de la organización: es la que el comercio ve y administra en su pantalla de
 * impuestos, y la que sus reportes fiscales esperan.
 */
export function preferOwnStoreCategories<
  T extends { store_id?: number | null },
>(categories: T[], storeId: number): T[] {
  return [
    ...categories.filter((category) => category.store_id === storeId),
    ...categories.filter((category) => category.store_id !== storeId),
  ];
}
