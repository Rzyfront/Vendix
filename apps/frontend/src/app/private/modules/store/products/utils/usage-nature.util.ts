/**
 * Naturaleza de uso del producto (`products.usage_nature`).
 * Espejo de `apps/backend/src/domains/store/products/services/product-usage-nature.util.ts`.
 *
 * - Venta: existe para venderse.
 * - Insumo: solo entra en recetas, producción o fórmulas. Nunca se vende.
 * - Uso interno: lo consume la operación. Nunca se vende.
 */
export type ProductUsageNature = 'sale' | 'supply' | 'internal_use';

export const USAGE_NATURE_ORDER: ProductUsageNature[] = ['sale', 'supply', 'internal_use'];

export const USAGE_NATURE_LABELS: Record<ProductUsageNature, string> = {
  sale: 'Venta',
  supply: 'Insumo',
  internal_use: 'Uso interno',
};

/** Etiquetas en plural para las pestañas del listado. */
export const USAGE_NATURE_TAB_LABELS: Record<ProductUsageNature, string> = {
  sale: 'Venta',
  supply: 'Insumos',
  internal_use: 'Uso interno',
};

export const USAGE_NATURE_HELP: Record<ProductUsageNature, string> = {
  sale: 'Se vende a tus clientes en POS, carta y tienda en línea.',
  supply: 'Materia prima para recetas o producción. Nunca se vende; conserva costo y stock.',
  internal_use: 'Lo usa tu operación (ropería, aseo, amenidades). Nunca se vende; conserva stock.',
};

export const USAGE_NATURE_COLORS: Record<ProductUsageNature, string> = {
  sale: '#16a34a',
  supply: '#d97706',
  internal_use: '#64748b',
};

/**
 * Naturaleza efectiva: el insumo puro anterior a la columna
 * (`is_ingredient && !is_sellable`, quedó en `sale`) cuenta como Insumo,
 * igual que en el backend.
 */
export function effectiveUsageNature(p: {
  usage_nature?: ProductUsageNature | null;
  is_ingredient?: boolean | null;
  is_sellable?: boolean | null;
}): ProductUsageNature {
  const nature = p.usage_nature ?? 'sale';
  if (nature === 'sale' && p.is_ingredient === true && p.is_sellable === false) {
    return 'supply';
  }
  return nature;
}
