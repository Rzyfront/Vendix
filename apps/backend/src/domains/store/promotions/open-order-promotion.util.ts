import { resolvePriceUnits } from '../products/services/price-unit.util';
import {
  applyGrossDiscountRetax,
  distributeAmount,
  resolveGrossDiscountByLine,
  type GrossDiscountableLine,
  type GrossDiscountSplit,
} from '../taxes/utils/order-discount-tax.util';
import type { PromotionQuoteItemInput } from './dto/promotion-quote.interface';

/**
 * Cotización + retax de líneas YA persistidas de una orden abierta (cuenta de
 * mesa). Una sola implementación para la cuenta abierta
 * (`OpenOrderPromotionService`) y para el cobro
 * (`PaymentsService.applyPosPaymentToTableSession`): lo que la cuenta muestra
 * es lo que el cobro cobra.
 */

const roundMoney = (value: number): number =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/** Multiplicador de precio de una línea (1 si es pesable). */
export function lineMultiplier(item: any): number {
  return Number(item.weight || 0) > 0
    ? 1
    : resolvePriceUnits(Number(item.quantity || 1), item.price_unit_quantity);
}

/**
 * Tarifa (fracción) de una fila de impuesto para el retax. Usa `tax_rate`;
 * si falta (fila histórica sin tarifa), la deriva de `tax_amount / base`
 * para no anular el impuesto al recalcular hacia adelante.
 */
export function resolveRetaxRate(row: any, base: number): number {
  const rate = Number(row?.tax_rate || 0);
  if (rate > 0) return rate;
  const amount = Number(row?.tax_amount || 0);
  return base > 0 && amount > 0 ? amount / base : 0;
}

/**
 * Impuesto PRE-descuento de una línea YA persistida. Las filas
 * `order_item_taxes.tax_amount` y `order_items.tax_amount_item` se
 * sobrescriben con el valor post-descuento en cada recotización; `total_price`
 * (base) jamás se muta, así que `tax_rate × total_price` es la fuente
 * estable. Sin `tax_rate` cae al valor persistido.
 */
export function resolvePreDiscountLineTax(item: any, rows: any[]): number {
  const base = Number(item.total_price || 0);
  if (rows.length > 0) {
    return rows.reduce((s: number, r: any) => {
      const rate = Number(r.tax_rate || 0);
      return (
        s + (rate > 0 ? roundMoney(rate * base) : Number(r.tax_amount || 0))
      );
    }, 0);
  }
  const itemRate = Number(item.tax_rate || 0);
  return itemRate > 0
    ? roundMoney(itemRate * base)
    : roundMoney(Number(item.tax_amount_item || 0) * lineMultiplier(item));
}

/**
 * Línea persistida → ítem del motor de promociones. El precio que se cotiza
 * es el BRUTO pre-descuento por unidad de precio: `final_unit_price` (el
 * mismo dato que manda el POS directo) y, si la línea no lo tiene, base +
 * impuesto pre-descuento entre sus unidades de precio. `null` para ítems
 * custom sin producto (el motor no los cotiza).
 */
export function persistedLineToPromotionQuoteItem(
  item: any,
  lineId: number,
  categoryIdsByProduct?: ReadonlyMap<number, number[]>,
): PromotionQuoteItemInput | null {
  if (!item?.product_id) return null;
  const rows = Array.isArray(item.order_item_taxes)
    ? item.order_item_taxes
    : [];
  const snapshotGross = Number(item.final_unit_price || 0);
  const multiplier = lineMultiplier(item);
  const unitGross =
    snapshotGross > 0
      ? snapshotGross
      : multiplier > 0
        ? roundMoney(
            (Number(item.total_price || 0) +
              resolvePreDiscountLineTax(item, rows)) /
              multiplier,
          )
        : 0;
  return {
    line_id: lineId,
    product_id: Number(item.product_id),
    variant_id: item.product_variant_id ?? null,
    category_id: null,
    category_ids: categoryIdsByProduct?.get(Number(item.product_id)) ?? null,
    unit_price: unitGross,
    quantity: Number(item.quantity || 0),
    applied_price_tier_id: item.applied_price_tier_id ?? null,
    // Línea de PESO: `stock_units_consumed` es la pesada, no paquetes.
    stock_units_consumed:
      Number(item.weight || 0) > 0 ? null : (item.stock_units_consumed ?? null),
  };
}

/** Categorías por producto: sin ellas una promo por categoría cotiza 0. */
export async function loadCategoryIdsByProduct(
  db: any,
  productIds: ReadonlyArray<number>,
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  const ids = Array.from(new Set(productIds.filter((id) => Number(id) > 0)));
  if (ids.length === 0) return map;
  const rows: Array<{ product_id: number; category_id: number }> =
    (await db.product_categories.findMany({
      where: { product_id: { in: ids } },
      select: { product_id: true, category_id: true },
    })) ?? [];
  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    list.push(row.category_id);
    map.set(row.product_id, list);
  }
  return map;
}

/**
 * Retax de las líneas de una orden abierta: `existingItems` YA persistidas
 * (requieren `tx.update` de `order_items` y `order_item_taxes`) y `newItems`
 * aún en memoria (`order_item_taxes.create[]`, se mutan en sitio).
 *
 * El descuento es sobre la BASE sin impuesto y el impuesto se recalcula sobre
 * la base descontada. Con `split` (F1) la promoción va a sus líneas (índices
 * sobre `[...existingItems, ...newItems]`) y el cupón al bruto remanente; sin
 * desglose, proporcional al bruto de todas. `tax_amount_item` es el impuesto
 * de una unidad de PRECIO: nuevo impuesto de línea entre su multiplicador.
 */
export async function retaxOpenOrderLines(
  tx: any,
  existingItems: any[],
  newItems: any[],
  totalGrossDiscount: number,
  split: GrossDiscountSplit | null = null,
): Promise<{ tax_amount: number; discount_amount_base: number }> {
  const allItems = [...existingItems, ...newItems];
  const rowsOf = (item: any): any[] =>
    Array.isArray(item.order_item_taxes)
      ? item.order_item_taxes
      : (item.order_item_taxes?.create ?? []);

  if (totalGrossDiscount <= 0) {
    // Sin descuento: contrato nuevo explícito (0, no NULL) en cada línea.
    // Una línea persistida que YA traía descuento (promo o cupón que dejó de
    // aplicar) restituye su impuesto pre-descuento.
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      if (i >= existingItems.length) {
        item.discount_amount = 0;
        continue;
      }
      const data: any = { discount_amount: 0 };
      if (Number(item.discount_amount || 0) > 0) {
        const rows = rowsOf(item);
        const base = Number(item.total_price || 0);
        let restoredLine = 0;
        for (const r of rows) {
          const rate = Number(r.tax_rate || 0);
          if (rate > 0) {
            const amount = roundMoney(rate * base);
            restoredLine += amount;
            await tx.order_item_taxes.update({
              where: { id: r.id },
              data: { tax_amount: amount },
            });
            r.tax_amount = amount;
          } else {
            restoredLine += Number(r.tax_amount || 0);
          }
        }
        if (rows.length > 0) {
          const multiplier = lineMultiplier(item);
          data.tax_amount_item =
            multiplier > 0
              ? roundMoney(restoredLine / multiplier)
              : restoredLine;
          item.tax_amount_item = data.tax_amount_item;
        }
      }
      await tx.order_items.update({ where: { id: item.id }, data });
    }
    const tax_amount = roundMoney(
      allItems.reduce((sum, item) => {
        const rows = rowsOf(item);
        if (rows.length > 0) {
          return (
            sum +
            rows.reduce((s: number, r: any) => s + Number(r.tax_amount || 0), 0)
          );
        }
        return sum + Number(item.tax_amount_item || 0) * lineMultiplier(item);
      }, 0),
    );
    return { tax_amount, discount_amount_base: 0 };
  }

  const lines: GrossDiscountableLine[] = allItems.map((item, index) => {
    const base = Number(item.total_price || 0);
    const rows = rowsOf(item);
    // Ítems persistidos: el impuesto guardado ya puede ser post-descuento
    // (recotización previa) -> se reconstruye desde la tarifa. Ítems nuevos:
    // `tax_amount` en memoria es pre-descuento.
    const preDiscountTax =
      index < existingItems.length
        ? resolvePreDiscountLineTax(item, rows)
        : rows.length > 0
          ? rows.reduce((s: number, r: any) => s + Number(r.tax_amount || 0), 0)
          : roundMoney(Number(item.tax_amount_item || 0) * lineMultiplier(item));
    return {
      base,
      grossOriginal: roundMoney(base + preDiscountTax),
      taxRows: rows.map((r: any) => ({
        rate: resolveRetaxRate(r, base),
        tax_type: r.tax_type,
        tax_rate_id: r.tax_rate_id,
        tax_name: r.tax_name,
      })),
    };
  });

  const grossDiscountByLine = split
    ? resolveGrossDiscountByLine(
        lines.map((l) => l.grossOriginal),
        split,
      )
    : distributeAmount(
        totalGrossDiscount,
        lines.map((l) => l.grossOriginal),
      );
  const retax = applyGrossDiscountRetax(lines, grossDiscountByLine);

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const lineResult = retax.lines[i];
    const rows = rowsOf(item);
    const multiplier = lineMultiplier(item);
    const newTaxAmountItem =
      multiplier > 0
        ? roundMoney(lineResult.taxTotal / multiplier)
        : lineResult.taxTotal;

    if (i < existingItems.length) {
      // Ítem YA persistido: requiere escritura explícita dentro de `tx`.
      await tx.order_items.update({
        where: { id: item.id },
        data: {
          tax_amount_item: newTaxAmountItem,
          discount_amount: lineResult.baseDiscount,
        },
      });
      for (let k = 0; k < rows.length; k++) {
        if (lineResult.taxes[k] === undefined) continue;
        await tx.order_item_taxes.update({
          where: { id: rows[k].id },
          data: { tax_amount: lineResult.taxes[k].amount },
        });
      }
    } else {
      // Ítem nuevo aún en memoria (pre-insert): mutar en sitio.
      item.tax_amount_item = newTaxAmountItem;
      item.discount_amount = lineResult.baseDiscount;
      const createRows = item.order_item_taxes?.create;
      if (Array.isArray(createRows)) {
        createRows.forEach((r: any, k: number) => {
          if (lineResult.taxes[k]) r.tax_amount = lineResult.taxes[k].amount;
        });
      }
    }
  }

  return {
    tax_amount: retax.totalTax,
    discount_amount_base: retax.totalBaseDiscount,
  };
}
