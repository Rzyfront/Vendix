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
 * - `calculateVariantFinalPrice`: efectivo variante (sale variante > override >
 *   sale producto > base producto, F-216 — misma escalera que el cobro)
 *   resuelto con `resolveLineTotals`.
 * - `resolveLineUnits`: multiplicador canónico de línea (ADR-06 punto 5:
 *   `line_units`) con sus tres ramas — peso, escala, cantidad.
 * - `resolveOrderLineFinals`: final por línea de orden/mesa sobre el
 *   `unit_price` persistido × `line_units`, redondeado a 2.
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

/**
 * Precio efectivo de la variante: sale de variante > override de variante >
 * sale del producto > base del producto.
 *
 * F-216: los dos ultimos peldanos y los guardas `> 0` son nuevos, y existen
 * para que esta funcion — el productor de DISPLAY — diga exactamente lo mismo
 * que el productor de COBRO (`payments.service.ts:2436`
 * `resolveCatalogUnitBasePrice`), que ya resolvia asi. Antes caia directo a
 * `base_price` sin mirar `product.is_on_sale`: una variante sin precio propio
 * sobre un producto en oferta se publicaba al precio SIN descuento mientras el
 * cobro usaba el precio CON descuento. Eso era a la vez un error visible en
 * pantalla y una divergencia de un descuento entero contra el guard de
 * override del cobro (tolerancia `>= 0.01`), que con
 * `allow_pos_price_override = false` es un 400 en el mostrador.
 *
 * Los guardas `> 0` tambien se alinean con el cobro: un `price_override` de 0
 * o un `sale_price` de 0 no son un precio, son un campo sin llenar. El cobro
 * ya los saltaba; publicarlos como precio final de 0 era la otra mitad de la
 * misma divergencia.
 */
export function resolveVariantEffectivePrice(
  variant: VariantLike | null | undefined,
  product: ProductLike | null | undefined,
): number {
  if (variant?.is_on_sale && Number(variant?.sale_price ?? 0) > 0) {
    return Number(variant.sale_price);
  }
  if (variant?.price_override != null && Number(variant.price_override) > 0) {
    return Number(variant.price_override);
  }
  if (product?.is_on_sale && Number(product?.sale_price ?? 0) > 0) {
    return Number(product.sale_price);
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
 * Entrada mínima de línea que el serializador necesita leer. `weight` es el
 * peso capturado (`order_items.weight`) y `price_unit_quantity` la escala
 * snapshot (`order_items.price_unit_quantity`, NULL = 1).
 */
export interface OrderLineUnitsInput {
  quantity: unknown;
  weight?: unknown;
  price_unit_quantity?: unknown;
}

/**
 * Multiplicador canónico de línea — el `line_units` que ADR-06 punto 5 usa en
 * su fallback de lectura y nunca define. Tres ramas (C.12, cierra F-028):
 * peso capturado, escala (`quantity / price_unit_quantity`), cantidad pura.
 * Con guarda contra multiplicador ≤ 0: un multiplicador degenerado (0,
 * negativo o NaN) devuelve 0 en vez de dividir por cero o negativizar el
 * total. En la línea ordinaria (sin peso ni escala) devuelve `quantity`,
 * idéntico al comportamiento anterior.
 */
export function resolveLineUnits(
  line: OrderLineUnitsInput | null | undefined,
): number {
  const weight = Number(line?.weight ?? 0);
  if (Number.isFinite(weight) && weight > 0) return weight;
  const quantity = Number(line?.quantity ?? 0);
  const scaleRaw = Number(line?.price_unit_quantity ?? 1);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 1 ? scaleRaw : 1;
  const units = scale > 1 ? quantity / scale : quantity;
  return Number.isFinite(units) && units > 0 ? units : 0;
}

/**
 * Finales por línea de orden/mesa (display-only): el `unit_price` persistido
 * (que ya es el efectivo de la variante al crear la línea) resuelto con las
 * tasas del producto, y ese valor × `line_units` redondeado a 2.
 * `final_unit_price` no depende del multiplicador: sólo el total de línea
 * cambia (C.12, cierra F-202).
 *
 * F-151 (major, CP-pos-exclusive-tax-double-charge) — ADR-08 declara
 * `tax_amount_item IS NULL` el marcador permanente y gratuito que distingue
 * las DOS convenciones que conviven hoy en `order_items`: las líneas VIEJAS
 * (pre-ADR-08) persisten el PRECIO PUBLICADO (bruto) en `unit_price` y dejan
 * `tax_amount_item` en NULL; las líneas NUEVAS (post-ADR-08,
 * `table-sessions.service.ts:addItems` ~:800-870) persisten la BASE en
 * `unit_price` y el impuesto POR UNIDAD de precio en `tax_amount_item`. Antes
 * de este fix esta función le aplicaba las tasas a `unit_price`
 * incondicionalmente: para una línea vieja con una tasa EXCLUSIVA eso volvía
 * a sumar el impuesto sobre un valor que YA era bruto (`bruto × 1,19`),
 * inflando la pantalla. Ahora honra el marcador: si la línea NO trae
 * desglose (`tax_amount_item` explícitamente `null`, el caso real de una fila
 * pre-ADR-08 leída con el campo proyectado) el `unit_price` persistido YA es
 * el final publicado — se expone tal cual, sin volver a aplicar tasas. Con
 * desglose presente (`tax_amount_item` con un valor) se deriva como siempre,
 * porque ahí `unit_price` es la base.
 *
 * `tax_amount_item` es OPCIONAL a propósito: un llamador que no lo pase
 * (queda `undefined`, no `null`) cae en la rama "con desglose" y conserva
 * EXACTAMENTE el comportamiento de hoy (deriva siempre) — así ningún
 * llamador ajeno a este fix cambia de semántica sin que nadie lo revise.
 */
export function resolveOrderLineFinals(
  line: OrderLineUnitsInput & {
    unit_price: unknown;
    tax_amount_item?: unknown;
  },
  rates: TypedTaxRate[] | null | undefined,
): { final_unit_price: number; final_total_price: number } {
  const unitPrice = Number(line?.unit_price);
  // Marcador ADR-08: SOLO `null` explícito (línea vieja proyectada sin
  // desglose) desactiva el re-cálculo. `undefined` (campo ni siquiera
  // pasado por el llamador) NO cuenta como marcador — preserva el
  // comportamiento histórico para quien todavía no fue migrado.
  const hasNoTaxBreakdown = line?.tax_amount_item === null;
  const final_unit_price = hasNoTaxBreakdown
    ? unitPrice
    : resolveLineTotals(unitPrice, rates ?? []).total;
  return {
    final_unit_price,
    final_total_price: roundMoney2(final_unit_price * resolveLineUnits(line)),
  };
}
