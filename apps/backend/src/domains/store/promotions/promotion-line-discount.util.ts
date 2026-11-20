import type { PromotionQuoteResult } from './dto/promotion-quote.interface';

/**
 * Descuento promocional BRUTO por línea del caller, a partir de la cotización
 * del motor (`items[].promotion_discount`), para repartir una promoción de
 * producto, categoría o escala SOLO entre las líneas a las que aplica (F1).
 *
 * `lineIndexOf` traduce el `line_id` que el caller le dio al motor al índice
 * de sus propias líneas (`null` = no se puede ubicar).
 *
 * Devuelve `null` —y el caller conserva el reparto histórico por bruto entre
 * todas las líneas— cuando:
 * - no hay descuento promocional o la cotización no trae desglose;
 * - todas las promociones aplicadas son de alcance ORDEN (el reparto por bruto
 *   es justamente su semántica, y así no cambia un centavo frente a hoy);
 * - alguna línea con descuento no se puede ubicar (sin mapeo confiable, mejor
 *   el reparto histórico que atribuir el descuento a la línea equivocada).
 */
export function promotionDiscountByLine(
  quote: Partial<
    Pick<PromotionQuoteResult, 'items' | 'applied_promotions' | 'total_discount'>
  > | null | undefined,
  lineCount: number,
  lineIndexOf: (lineId: string | number | undefined) => number | null,
): number[] | null {
  if (!quote || !(Number(quote.total_discount) > 0)) return null;
  const items = quote.items ?? [];
  const applied = quote.applied_promotions ?? [];
  if (items.length === 0 || applied.length === 0) return null;
  if (applied.every((p) => p.scope === 'order')) return null;

  const byLine = new Array<number>(lineCount).fill(0);
  for (const item of items) {
    const discount = Number(item.promotion_discount) || 0;
    if (discount <= 0) continue;
    const index = lineIndexOf(item.line_id);
    if (index == null || !Number.isInteger(index) || index < 0 || index >= lineCount) {
      return null;
    }
    byLine[index] = Math.round((byLine[index] + discount) * 100) / 100;
  }
  return byLine;
}
