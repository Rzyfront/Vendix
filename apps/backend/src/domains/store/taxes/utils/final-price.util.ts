import { resolveLineTotals } from './tax-inclusive-math.util';

/**
 * Precio FINAL con impuesto (display-only) — helpers puros compartidos.
 *
 * Los valores persistidos (`base_price`, `unit_price`, `total_price`) siguen
 * siendo pre-tax; estos helpers SOLO derivan lo que la UI muestra. Ningún
 * writer los consume.
 *
 * - `extractTypedRates`: fuente de la verdad (F-004) con precedencia canónica
 *   F-012 por asignación (`assignment.is_inclusive ?? category.is_inclusive
 *   ?? primera_tasa.is_inclusive ?? false`). Las asignaciones viven solo a
 *   nivel producto (`product_tax_assignments.product_id`): las variantes
 *   heredan las tasas del producto.
 * - `calculateVariantFinalPrice`: efectivo variante (sale > override > base
 *   del producto) resuelto con `resolveLineTotals`.
 * - `resolveOrderLineFinals`: final por línea de orden/mesa sobre el
 *   `unit_price` persistido × cantidad, redondeado a 2.
 */

export interface TypedTaxRate {
  rate: number;
  is_inclusive: boolean;
}

interface TaxAssignmentLike {
  is_inclusive?: boolean | null;
  tax_categories?: {
    is_inclusive?: boolean | null;
    tax_rates?: Array<{
      rate: number | string;
      is_inclusive?: boolean | null;
    } | null> | null;
  } | null;
}

interface ProductLike {
  base_price?: number | string | null;
  is_on_sale?: boolean | null;
  sale_price?: number | string | null;
  product_tax_assignments?: TaxAssignmentLike[] | null;
}

interface VariantLike {
  is_on_sale?: boolean | null;
  sale_price?: number | string | null;
  price_override?: number | string | null;
}

/**
 * Tasas tipadas `{ rate, is_inclusive }` desde las asignaciones del producto.
 * Extraído de `ProductsService.calculateFinalPrice` sin cambiar la
 * precedencia: el flag se hereda por asignación con el default canónico del
 * catálogo (F-012). Sin asignaciones devuelve `[]` y `resolveLineTotals`
 * devuelve el precio intacto (cero regresión histórica).
 */
export function extractTypedRates(product: ProductLike | null | undefined): TypedTaxRate[] {
  const rates: TypedTaxRate[] = [];
  const assignments = product?.product_tax_assignments;
  if (!assignments) return rates;
  for (const assignment of assignments) {
    const flag =
      assignment?.is_inclusive ??
      assignment?.tax_categories?.is_inclusive ??
      assignment?.tax_categories?.tax_rates?.[0]?.is_inclusive ??
      false;
    const taxes = assignment?.tax_categories?.tax_rates;
    if (taxes) {
      for (const tax of taxes) {
        if (tax == null) continue;
        rates.push({ rate: Number(tax.rate), is_inclusive: !!flag });
      }
    }
  }
  return rates;
}

/** Precio efectivo de la variante: sale > override > base del producto. */
export function resolveVariantEffectivePrice(
  variant: VariantLike | null | undefined,
  product: ProductLike | null | undefined,
): number {
  if (variant?.is_on_sale && variant?.sale_price) {
    return Number(variant.sale_price);
  }
  if (variant?.price_override != null) {
    return Number(variant.price_override);
  }
  return Number(product?.base_price ?? 0);
}

/**
 * Final de la variante (display-only): efectivo resuelto con las tasas
 * heredadas del producto. Inclusivo NO crece el total; agregado suma encima.
 */
export function calculateVariantFinalPrice(
  variant: VariantLike | null | undefined,
  product: ProductLike | null | undefined,
): number {
  return resolveLineTotals(
    resolveVariantEffectivePrice(variant, product),
    extractTypedRates(product),
  ).total;
}

/**
 * Agrupa asignaciones (`product_tax_assignments` con `tax_categories.tax_rates`
 * incluido, UN batch por `product_id`) en tasas tipadas por producto. Puro:
 * el servicio hace el `findMany` y esta función agrupa.
 */
export function groupRatesByProductId(
  assignments: Array<TaxAssignmentLike & { product_id: number }>,
): Map<number, TypedTaxRate[]> {
  const byProduct = new Map<number, TypedTaxRate[]>();
  for (const row of assignments ?? []) {
    if (row?.product_id == null) continue;
    const list = byProduct.get(row.product_id) ?? [];
    list.push(...extractTypedRates({ product_tax_assignments: [row] }));
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}

/** Redondeo monetario a 2 decimales para el total de la línea. */
export function roundMoney2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Finales por línea de orden/mesa (display-only): el `unit_price` persistido
 * (que ya es el efectivo de la variante al crear la línea) resuelto con las
 * tasas del producto, y ese valor × cantidad redondeado a 2.
 */
export function resolveOrderLineFinals(
  unitPrice: number | string,
  quantity: number,
  rates: TypedTaxRate[] | null | undefined,
): { final_unit_price: number; final_total_price: number } {
  const final_unit_price = resolveLineTotals(Number(unitPrice), rates ?? []).total;
  const qty = Number(quantity);
  return {
    final_unit_price,
    final_total_price: roundMoney2(final_unit_price * (Number.isFinite(qty) ? qty : 0)),
  };
}
